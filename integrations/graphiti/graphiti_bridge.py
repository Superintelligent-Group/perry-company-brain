import asyncio
import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

_graphiti: Any | None = None
_init_error: str | None = None
_loop = asyncio.new_event_loop()
_loop_started = False
_loop_lock = threading.Lock()


def _json(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("content-length") or "0")
    if length <= 0:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def _run(coro: Any) -> Any:
    global _loop_started
    with _loop_lock:
        if not _loop_started:
            thread = threading.Thread(target=_loop.run_forever, daemon=True)
            thread.start()
            _loop_started = True
    return asyncio.run_coroutine_threadsafe(coro, _loop).result()


async def _client() -> Any:
    global _graphiti
    global _init_error
    if _graphiti is not None:
        return _graphiti

    graphiti = _build_graphiti()
    _graphiti = graphiti
    await _graphiti.build_indices_and_constraints()
    _init_error = None
    return _graphiti


def _build_graphiti() -> Any:
    from graphiti_core import Graphiti

    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD")
    if not password:
        _init_error = "NEO4J_PASSWORD is required"
        raise RuntimeError(_init_error)

    provider = os.environ.get("GRAPHITI_LLM_PROVIDER", "openai").lower()
    if provider in {"lmstudio", "openai-compatible", "ollama"}:
        return _build_openai_compatible_graphiti(uri, user, password)
    return Graphiti(uri, user, password)


def _build_openai_compatible_graphiti(uri: str, user: str, password: str) -> Any:
    from graphiti_core import Graphiti
    from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
    from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
    from graphiti_core.llm_client.config import LLMConfig
    from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient

    base_url = os.environ.get("GRAPHITI_OPENAI_BASE_URL", "http://127.0.0.1:1234/v1")
    api_key = os.environ.get("GRAPHITI_OPENAI_API_KEY", "lm-studio")
    model = os.environ.get("GRAPHITI_LLM_MODEL", "qwen/qwen3-coder-30b")
    small_model = os.environ.get("GRAPHITI_SMALL_LLM_MODEL", model)
    embedding_model = os.environ.get("GRAPHITI_EMBEDDING_MODEL", "text-embedding-nomic-embed-text-v1.5")
    embedding_dim = int(os.environ.get("GRAPHITI_EMBEDDING_DIM", "768"))

    llm_config = LLMConfig(
        api_key=api_key,
        model=model,
        small_model=small_model,
        base_url=base_url,
    )
    llm_client = OpenAIGenericClient(config=llm_config)

    return Graphiti(
        uri,
        user,
        password,
        llm_client=llm_client,
        embedder=OpenAIEmbedder(
            config=OpenAIEmbedderConfig(
                api_key=api_key,
                embedding_model=embedding_model,
                embedding_dim=embedding_dim,
                base_url=base_url,
            )
        ),
        cross_encoder=OpenAIRerankerClient(client=llm_client, config=llm_config),
    )


async def _add_episode(payload: dict[str, Any]) -> dict[str, Any]:
    from graphiti_core.nodes import EpisodeType

    client = await _client()
    source_name = str(payload.get("source") or "json")
    source = getattr(EpisodeType, source_name)
    reference_time = _parse_time(payload.get("referenceTime"))
    body = payload.get("body")
    if not isinstance(body, str):
        body = json.dumps(body)

    await client.add_episode(
        name=str(payload.get("name") or f"perry-{datetime.now(timezone.utc).isoformat()}"),
        episode_body=body,
        source=source,
        source_description=str(payload.get("sourceDescription") or "Perry episode"),
        reference_time=reference_time,
        group_id=payload.get("groupId") or os.environ.get("GRAPHITI_GROUP_ID", "doppel-labs"),
    )
    return {"ok": True}


async def _search(payload: dict[str, Any]) -> dict[str, Any]:
    client = await _client()
    query = str(payload.get("query") or "").strip()
    if not query:
        return {"ok": True, "results": []}

    limit = max(1, min(int(payload.get("limit") or 10), 50))
    group_id = payload.get("groupId") or os.environ.get("GRAPHITI_GROUP_ID", "doppel-labs")
    results = await client.search(
        query,
        group_ids=[group_id],
    )
    serialized = [_serialize_result(item) for item in results[:limit]]
    if not serialized:
        serialized = _fallback_entity_search(query, group_id, limit)
    return {"ok": True, "results": serialized}


async def _apply_change_set(payload: dict[str, Any]) -> dict[str, Any]:
    group_id = str(payload.get("groupId") or os.environ.get("GRAPHITI_GROUP_ID", "doppel-labs"))
    change_set = payload.get("changeSet") or payload.get("graphChangeSet") or payload
    if not isinstance(change_set, dict):
        raise ValueError("changeSet must be an object")

    entities = _as_list(change_set.get("entities"))
    evidence = _as_list(change_set.get("evidence"))
    relations = _as_list(change_set.get("relations"))
    retirements = _as_list(change_set.get("retirements"))

    from neo4j import GraphDatabase

    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD")
    if not password:
        raise RuntimeError("NEO4J_PASSWORD is required")

    driver = GraphDatabase.driver(uri, auth=(user, password))
    try:
        with driver.session() as session:
            _build_perry_graph_indices(session)
            for item in evidence:
                _apply_evidence(session, group_id, item)
            for item in entities:
                _apply_entity(session, group_id, item)
            for item in entities:
                _link_entity_evidence(session, group_id, item)
            for item in relations:
                _apply_relation(session, group_id, item)
            for item in retirements:
                _apply_retirement(session, group_id, item)
    finally:
        driver.close()

    return {
        "ok": True,
        "groupId": group_id,
        "applied": {
            "entities": len(entities),
            "evidence": len(evidence),
            "relations": len(relations),
            "retirements": len(retirements),
        },
    }


def _list_entities(params: dict[str, list[str]]) -> dict[str, Any]:
    group_id = _param(params, "groupId", os.environ.get("GRAPHITI_GROUP_ID", "doppel-labs"))
    query = _param(params, "q", "").strip()
    entity_type = _param(params, "type", "").strip() or None
    limit = max(1, min(int(_param(params, "limit", "25")), 100))

    from neo4j import GraphDatabase

    driver = GraphDatabase.driver(_neo4j_uri(), auth=(_neo4j_user(), _neo4j_password()))
    try:
        with driver.session() as session:
            rows = session.run(
                """
                MATCH (n:PerryGraphEntity)
                WHERE n.group_id = $group_id
                  AND ($entity_type IS NULL OR n.entity_type = $entity_type)
                  AND (
                    $search_text = ""
                    OR toLower(coalesce(n.stable_key, "")) CONTAINS toLower($search_text)
                    OR toLower(coalesce(n.name, "")) CONTAINS toLower($search_text)
                    OR toLower(coalesce(n.aliases_json, "")) CONTAINS toLower($search_text)
                    OR toLower(coalesce(n.properties_json, "")) CONTAINS toLower($search_text)
                  )
                RETURN properties(n) AS props
                ORDER BY coalesce(n.name, n.stable_key)
                LIMIT $limit
                """,
                group_id=group_id,
                entity_type=entity_type,
                search_text=query,
                limit=limit,
            )
            return {"ok": True, "groupId": group_id, "entities": [_serialize_entity(row["props"]) for row in rows]}
    finally:
        driver.close()


def _list_facts(params: dict[str, list[str]]) -> dict[str, Any]:
    group_id = _param(params, "groupId", os.environ.get("GRAPHITI_GROUP_ID", "doppel-labs"))
    subject = _param(params, "subject", "").strip() or None
    object_key = _param(params, "object", "").strip() or None
    relation = _param(params, "relation", "").strip() or None
    active = _parse_bool_param(params, "active")
    limit = max(1, min(int(_param(params, "limit", "25")), 100))

    from neo4j import GraphDatabase

    driver = GraphDatabase.driver(_neo4j_uri(), auth=(_neo4j_user(), _neo4j_password()))
    try:
        with driver.session() as session:
            rows = session.run(
                """
                MATCH (f:PerryGraphFact)
                WHERE f.group_id = $group_id
                  AND ($subject IS NULL OR f.subject_key = $subject)
                  AND ($object_key IS NULL OR f.object_key = $object_key)
                  AND ($relation IS NULL OR f.relation = $relation)
                  AND ($active IS NULL OR f.active = $active)
                OPTIONAL MATCH (s:PerryGraphEntity {group_id: $group_id, stable_key: f.subject_key})
                OPTIONAL MATCH (o:PerryGraphEntity {group_id: $group_id, stable_key: f.object_key})
                OPTIONAL MATCH (e:PerryGraphEvidence {group_id: $group_id, evidence_id: f.evidence_id})
                RETURN properties(f) AS fact, properties(s) AS subject, properties(o) AS object, properties(e) AS evidence
                ORDER BY coalesce(f.valid_from, "") DESC, f.updated_at DESC
                LIMIT $limit
                """,
                group_id=group_id,
                subject=subject,
                object_key=object_key,
                relation=relation,
                active=active,
                limit=limit,
            )
            return {"ok": True, "groupId": group_id, "facts": [_serialize_fact_row(row) for row in rows]}
    finally:
        driver.close()


def _get_evidence(params: dict[str, list[str]]) -> dict[str, Any]:
    group_id = _param(params, "groupId", os.environ.get("GRAPHITI_GROUP_ID", "doppel-labs"))
    evidence_id = _param(params, "evidenceId", "").strip()
    if not evidence_id:
        return {"ok": False, "error": "evidenceId is required"}

    from neo4j import GraphDatabase

    driver = GraphDatabase.driver(_neo4j_uri(), auth=(_neo4j_user(), _neo4j_password()))
    try:
        with driver.session() as session:
            row = session.run(
                """
                MATCH (e:PerryGraphEvidence {group_id: $group_id, evidence_id: $evidence_id})
                RETURN properties(e) AS props
                LIMIT 1
                """,
                group_id=group_id,
                evidence_id=evidence_id,
            ).single()
            return {"ok": True, "groupId": group_id, "evidence": _serialize_evidence(row["props"]) if row else None}
    finally:
        driver.close()


def _get_entity_context(params: dict[str, list[str]]) -> dict[str, Any]:
    group_id = _param(params, "groupId", os.environ.get("GRAPHITI_GROUP_ID", "doppel-labs"))
    stable_key = _param(params, "stableKey", "").strip()
    if not stable_key:
        return {"ok": False, "error": "stableKey is required"}
    limit = max(1, min(int(_param(params, "limit", "25")), 100))

    from neo4j import GraphDatabase

    driver = GraphDatabase.driver(_neo4j_uri(), auth=(_neo4j_user(), _neo4j_password()))
    try:
        with driver.session() as session:
            entity_row = session.run(
                """
                MATCH (n:PerryGraphEntity {group_id: $group_id, stable_key: $stable_key})
                RETURN properties(n) AS props
                LIMIT 1
                """,
                group_id=group_id,
                stable_key=stable_key,
            ).single()
            facts = session.run(
                """
                MATCH (f:PerryGraphFact)
                WHERE f.group_id = $group_id
                  AND (f.subject_key = $stable_key OR f.object_key = $stable_key)
                OPTIONAL MATCH (s:PerryGraphEntity {group_id: $group_id, stable_key: f.subject_key})
                OPTIONAL MATCH (o:PerryGraphEntity {group_id: $group_id, stable_key: f.object_key})
                OPTIONAL MATCH (e:PerryGraphEvidence {group_id: $group_id, evidence_id: f.evidence_id})
                RETURN properties(f) AS fact, properties(s) AS subject, properties(o) AS object, properties(e) AS evidence
                ORDER BY coalesce(f.valid_from, "") DESC, f.updated_at DESC
                LIMIT $limit
                """,
                group_id=group_id,
                stable_key=stable_key,
                limit=limit,
            )
            retirements = session.run(
                """
                MATCH (t:PerryGraphRetirement)
                WHERE t.group_id = $group_id
                  AND (t.subject_key = $stable_key OR t.object_key = $stable_key)
                OPTIONAL MATCH (e:PerryGraphEvidence {group_id: $group_id, evidence_id: t.evidence_id})
                RETURN properties(t) AS retirement, properties(e) AS evidence
                ORDER BY coalesce(t.valid_until, "") DESC, t.updated_at DESC
                LIMIT $limit
                """,
                group_id=group_id,
                stable_key=stable_key,
                limit=limit,
            )
            return {
                "ok": True,
                "groupId": group_id,
                "entity": _serialize_entity(entity_row["props"]) if entity_row else None,
                "facts": [_serialize_fact_row(row) for row in facts],
                "retirements": [_serialize_retirement_row(row) for row in retirements],
            }
    finally:
        driver.close()


def _get_timeline(params: dict[str, list[str]]) -> dict[str, Any]:
    group_id = _param(params, "groupId", os.environ.get("GRAPHITI_GROUP_ID", "doppel-labs"))
    stable_key = _param(params, "stableKey", _param(params, "entity", "")).strip()
    if not stable_key:
        return {"ok": False, "error": "stableKey is required"}
    limit = max(1, min(int(_param(params, "limit", "50")), 100))

    context = _get_entity_context({"groupId": [group_id], "stableKey": [stable_key], "limit": [str(limit)]})
    events = []
    for fact in context.get("facts", []):
        fact_body = fact.get("fact") or {}
        events.append({"type": "fact", "at": fact_body.get("validFrom") or fact_body.get("updatedAt"), "item": fact})
    for retirement in context.get("retirements", []):
        retirement_body = retirement.get("retirement") or {}
        events.append(
            {
                "type": "retirement",
                "at": retirement_body.get("validUntil") or retirement_body.get("updatedAt"),
                "item": retirement,
            }
        )
    events.sort(key=lambda item: str(item.get("at") or ""), reverse=True)
    return {"ok": True, "groupId": group_id, "stableKey": stable_key, "events": events[:limit]}


def _build_perry_graph_indices(session: Any) -> None:
    session.run(
        "CREATE CONSTRAINT perry_graph_entity_key IF NOT EXISTS "
        "FOR (n:PerryGraphEntity) REQUIRE (n.group_id, n.stable_key) IS UNIQUE"
    ).consume()


def _neo4j_uri() -> str:
    return os.environ.get("NEO4J_URI", "bolt://localhost:7687")


def _neo4j_user() -> str:
    return os.environ.get("NEO4J_USER", "neo4j")


def _neo4j_password() -> str:
    password = os.environ.get("NEO4J_PASSWORD")
    if not password:
        raise RuntimeError("NEO4J_PASSWORD is required")
    return password
    session.run(
        "CREATE CONSTRAINT perry_graph_evidence_key IF NOT EXISTS "
        "FOR (n:PerryGraphEvidence) REQUIRE (n.group_id, n.evidence_id) IS UNIQUE"
    ).consume()
    session.run(
        "CREATE CONSTRAINT perry_graph_fact_key IF NOT EXISTS "
        "FOR (n:PerryGraphFact) REQUIRE (n.group_id, n.fact_key) IS UNIQUE"
    ).consume()
    session.run(
        "CREATE CONSTRAINT perry_graph_retirement_key IF NOT EXISTS "
        "FOR (n:PerryGraphRetirement) REQUIRE (n.group_id, n.retirement_key) IS UNIQUE"
    ).consume()


def _apply_evidence(session: Any, group_id: str, item: dict[str, Any]) -> None:
    evidence_id = str(item.get("evidenceId") or "").strip()
    if not evidence_id:
        return
    session.run(
        """
        MERGE (e:PerryGraphEvidence {group_id: $group_id, evidence_id: $evidence_id})
        SET e.kind = $kind,
            e.source = $source,
            e.source_id = $source_id,
            e.meeting_id = $meeting_id,
            e.title = $title,
            e.excerpt = $excerpt,
            e.url = $url,
            e.updated_at = datetime()
        """,
        group_id=group_id,
        evidence_id=evidence_id,
        kind=item.get("kind"),
        source=item.get("source"),
        source_id=item.get("sourceId"),
        meeting_id=item.get("meetingId"),
        title=item.get("title"),
        excerpt=item.get("excerpt"),
        url=item.get("url"),
    ).consume()


def _apply_entity(session: Any, group_id: str, item: dict[str, Any]) -> None:
    stable_key = str(item.get("stableKey") or "").strip()
    if not stable_key:
        return
    session.run(
        """
        MERGE (n:PerryGraphEntity {group_id: $group_id, stable_key: $stable_key})
        SET n.entity_type = $entity_type,
            n.name = $name,
            n.aliases_json = $aliases_json,
            n.properties_json = $properties_json,
            n.evidence_ids_json = $evidence_ids_json,
            n.updated_at = datetime()
        """,
        group_id=group_id,
        stable_key=stable_key,
        entity_type=item.get("type"),
        name=item.get("name"),
        aliases_json=json.dumps(_as_list(item.get("aliases")), sort_keys=True),
        properties_json=json.dumps(item.get("properties") or {}, sort_keys=True),
        evidence_ids_json=json.dumps(_as_list(item.get("evidenceIds")), sort_keys=True),
    ).consume()


def _link_entity_evidence(session: Any, group_id: str, item: dict[str, Any]) -> None:
    stable_key = str(item.get("stableKey") or "").strip()
    if not stable_key:
        return
    for evidence_id in _as_list(item.get("evidenceIds")):
        session.run(
            """
            MATCH (n:PerryGraphEntity {group_id: $group_id, stable_key: $stable_key})
            MATCH (e:PerryGraphEvidence {group_id: $group_id, evidence_id: $evidence_id})
            MERGE (n)-[:PERRY_SUPPORTED_BY {group_id: $group_id}]->(e)
            """,
            group_id=group_id,
            stable_key=stable_key,
            evidence_id=evidence_id,
        ).consume()


def _apply_relation(session: Any, group_id: str, item: dict[str, Any]) -> None:
    subject_key = str(item.get("subjectKey") or "").strip()
    object_key = str(item.get("objectKey") or "").strip()
    relation = str(item.get("relation") or "").strip()
    evidence_id = str(item.get("evidenceId") or "").strip()
    if not subject_key or not object_key or not relation or not evidence_id:
        return
    fact_key = _stable_hash(group_id, subject_key, relation, object_key, evidence_id)
    session.run(
        """
        MATCH (s:PerryGraphEntity {group_id: $group_id, stable_key: $subject_key})
        MATCH (o:PerryGraphEntity {group_id: $group_id, stable_key: $object_key})
        MATCH (e:PerryGraphEvidence {group_id: $group_id, evidence_id: $evidence_id})
        MERGE (f:PerryGraphFact {group_id: $group_id, fact_key: $fact_key})
        SET f.subject_key = $subject_key,
            f.relation = $relation,
            f.object_key = $object_key,
            f.evidence_id = $evidence_id,
            f.valid_from = $valid_from,
            f.confidence = $confidence,
            f.properties_json = $properties_json,
            f.active = true,
            f.updated_at = datetime()
        MERGE (s)-[:PERRY_SUBJECT_OF {group_id: $group_id}]->(f)
        MERGE (f)-[:PERRY_OBJECT_OF {group_id: $group_id}]->(o)
        MERGE (f)-[:PERRY_SUPPORTED_BY {group_id: $group_id}]->(e)
        MERGE (s)-[r:PERRY_RELATION {group_id: $group_id, fact_key: $fact_key}]->(o)
        SET r.relation = $relation,
            r.evidence_id = $evidence_id,
            r.object_key = $object_key,
            r.valid_from = $valid_from,
            r.confidence = $confidence,
            r.properties_json = $properties_json,
            r.active = true,
            r.updated_at = datetime()
        """,
        group_id=group_id,
        subject_key=subject_key,
        relation=relation,
        object_key=object_key,
        evidence_id=evidence_id,
        fact_key=fact_key,
        valid_from=item.get("validFrom"),
        confidence=item.get("confidence"),
        properties_json=json.dumps(item.get("properties") or {}, sort_keys=True),
    ).consume()


def _apply_retirement(session: Any, group_id: str, item: dict[str, Any]) -> None:
    subject_key = str(item.get("subjectKey") or "").strip()
    object_key = str(item.get("objectKey") or "").strip()
    relation = str(item.get("relation") or "").strip()
    evidence_id = str(item.get("evidenceId") or "").strip()
    valid_until = item.get("validUntil")
    if not subject_key or not object_key or not relation or not evidence_id:
        return
    retirement_key = _stable_hash(group_id, subject_key, relation, object_key, evidence_id, str(valid_until))
    session.run(
        """
        MATCH (s:PerryGraphEntity {group_id: $group_id, stable_key: $subject_key})
        MATCH (o:PerryGraphEntity {group_id: $group_id, stable_key: $object_key})
        MATCH (e:PerryGraphEvidence {group_id: $group_id, evidence_id: $evidence_id})
        MERGE (t:PerryGraphRetirement {group_id: $group_id, retirement_key: $retirement_key})
        SET t.subject_key = $subject_key,
            t.relation = $relation,
            t.object_key = $object_key,
            t.evidence_id = $evidence_id,
            t.valid_until = $valid_until,
            t.reason = $reason,
            t.updated_at = datetime()
        MERGE (s)-[:PERRY_RETIRED_SUBJECT {group_id: $group_id}]->(t)
        MERGE (t)-[:PERRY_RETIRED_OBJECT {group_id: $group_id}]->(o)
        MERGE (t)-[:PERRY_SUPPORTED_BY {group_id: $group_id}]->(e)
        WITH s, o
        MATCH (s)-[r:PERRY_RELATION {group_id: $group_id, relation: $relation, object_key: $object_key}]->(o)
        SET r.active = false,
            r.valid_until = $valid_until,
            r.retired_by_evidence_id = $evidence_id,
            r.updated_at = datetime()
        """,
        group_id=group_id,
        subject_key=subject_key,
        relation=relation,
        object_key=object_key,
        evidence_id=evidence_id,
        retirement_key=retirement_key,
        valid_until=valid_until,
        reason=item.get("reason"),
    ).consume()


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _stable_hash(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def _param(params: dict[str, list[str]], key: str, default: str = "") -> str:
    values = params.get(key)
    if not values:
        return default
    return unquote(str(values[0]))


def _parse_bool_param(params: dict[str, list[str]], key: str) -> bool | None:
    value = _param(params, key, "").lower()
    if value in {"true", "1", "yes"}:
        return True
    if value in {"false", "0", "no"}:
        return False
    return None


def _json_prop(value: Any, fallback: Any) -> Any:
    if not isinstance(value, str) or not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def _serialize_entity(props: Any) -> dict[str, Any] | None:
    if not props:
        return None
    raw = dict(props)
    return {
        "stableKey": raw.get("stable_key"),
        "type": raw.get("entity_type"),
        "name": raw.get("name"),
        "aliases": _json_prop(raw.get("aliases_json"), []),
        "properties": _json_prop(raw.get("properties_json"), {}),
        "evidenceIds": _json_prop(raw.get("evidence_ids_json"), []),
        "updatedAt": _json_safe(raw.get("updated_at")),
    }


def _serialize_evidence(props: Any) -> dict[str, Any] | None:
    if not props:
        return None
    raw = dict(props)
    return {
        "evidenceId": raw.get("evidence_id"),
        "kind": raw.get("kind"),
        "source": raw.get("source"),
        "sourceId": raw.get("source_id"),
        "meetingId": raw.get("meeting_id"),
        "title": raw.get("title"),
        "excerpt": raw.get("excerpt"),
        "url": raw.get("url"),
        "updatedAt": _json_safe(raw.get("updated_at")),
    }


def _serialize_fact(props: Any) -> dict[str, Any] | None:
    if not props:
        return None
    raw = dict(props)
    return {
        "factKey": raw.get("fact_key"),
        "subjectKey": raw.get("subject_key"),
        "relation": raw.get("relation"),
        "objectKey": raw.get("object_key"),
        "evidenceId": raw.get("evidence_id"),
        "validFrom": raw.get("valid_from"),
        "confidence": raw.get("confidence"),
        "active": raw.get("active"),
        "properties": _json_prop(raw.get("properties_json"), {}),
        "updatedAt": _json_safe(raw.get("updated_at")),
    }


def _serialize_fact_row(row: Any) -> dict[str, Any]:
    return {
        "fact": _serialize_fact(row["fact"]),
        "subject": _serialize_entity(row["subject"]),
        "object": _serialize_entity(row["object"]),
        "evidence": _serialize_evidence(row["evidence"]),
    }


def _serialize_retirement(props: Any) -> dict[str, Any] | None:
    if not props:
        return None
    raw = dict(props)
    return {
        "retirementKey": raw.get("retirement_key"),
        "subjectKey": raw.get("subject_key"),
        "relation": raw.get("relation"),
        "objectKey": raw.get("object_key"),
        "evidenceId": raw.get("evidence_id"),
        "validUntil": raw.get("valid_until"),
        "reason": raw.get("reason"),
        "updatedAt": _json_safe(raw.get("updated_at")),
    }


def _serialize_retirement_row(row: Any) -> dict[str, Any]:
    return {
        "retirement": _serialize_retirement(row["retirement"]),
        "evidence": _serialize_evidence(row["evidence"]),
    }


def _parse_time(value: Any) -> datetime:
    if isinstance(value, str) and value:
        normalized = value.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _serialize_result(item: Any) -> dict[str, Any]:
    if hasattr(item, "model_dump"):
        raw = item.model_dump(mode="json")
    elif hasattr(item, "__dict__"):
        raw = dict(item.__dict__)
    else:
        raw = {"value": str(item)}
    raw = _json_safe(raw)

    return {
        "fact": raw.get("fact"),
        "name": raw.get("name"),
        "uuid": raw.get("uuid"),
        "sourceNode": raw.get("source_node_uuid"),
        "targetNode": raw.get("target_node_uuid"),
        "score": raw.get("score"),
        "raw": raw,
    }


def _fallback_entity_search(query: str, group_id: str, limit: int) -> list[dict[str, Any]]:
    from neo4j import GraphDatabase

    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD")
    if not password:
        return []

    driver = GraphDatabase.driver(uri, auth=(user, password))
    try:
        with driver.session() as session:
            rows = session.run(
                """
                MATCH (n)
                WHERE n.group_id = $group_id
                  AND (
                    toLower(coalesce(n.name, "")) CONTAINS toLower($search_text)
                    OR toLower(coalesce(n.summary, "")) CONTAINS toLower($search_text)
                    OR toLower(coalesce(n.content, "")) CONTAINS toLower($search_text)
                  )
                RETURN labels(n) AS labels, properties(n) AS props
                LIMIT $limit
                """,
                group_id=group_id,
                search_text=query,
                limit=limit,
            )
            return [_serialize_fallback_row(row) for row in rows]
    finally:
        driver.close()


def _serialize_fallback_row(row: Any) -> dict[str, Any]:
    props = _json_safe(dict(row["props"]))
    props.pop("name_embedding", None)
    labels = _json_safe(row["labels"])
    return {
        "fact": props.get("summary") or props.get("content"),
        "name": props.get("name"),
        "uuid": props.get("uuid"),
        "score": None,
        "raw": {
            "labels": labels,
            "properties": props,
            "fallback": True,
        },
    }


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    iso_format = getattr(value, "iso_format", None)
    if callable(iso_format):
        return iso_format()
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return isoformat()
    return value


def _provider_status() -> dict[str, Any]:
    return {
        "provider": os.environ.get("GRAPHITI_LLM_PROVIDER", "openai"),
        "baseUrl": os.environ.get("GRAPHITI_OPENAI_BASE_URL", "http://127.0.0.1:1234/v1"),
        "model": os.environ.get("GRAPHITI_LLM_MODEL", "qwen/qwen3-coder-30b"),
        "smallModel": os.environ.get("GRAPHITI_SMALL_LLM_MODEL", os.environ.get("GRAPHITI_LLM_MODEL", "qwen/qwen3-coder-30b")),
        "embeddingModel": os.environ.get("GRAPHITI_EMBEDDING_MODEL", "text-embedding-nomic-embed-text-v1.5"),
        "embeddingDim": int(os.environ.get("GRAPHITI_EMBEDDING_DIM", "768")),
    }


def _llm_health() -> dict[str, Any]:
    provider = _provider_status()
    if str(provider["provider"]).lower() not in {"lmstudio", "openai-compatible", "ollama"}:
        return {"ok": True, **provider, "note": "Default Graphiti provider; local model health not checked"}

    models_url = f"{str(provider['baseUrl']).rstrip('/')}/models"
    request = Request(models_url, headers={"authorization": f"Bearer {os.environ.get('GRAPHITI_OPENAI_API_KEY', 'lm-studio')}"})
    try:
        with urlopen(request, timeout=3) as response:
            body = json.loads(response.read().decode("utf-8"))
    except Exception as error:
        return {"ok": False, **provider, "error": str(error)}

    model_ids = [item.get("id") for item in body.get("data", []) if isinstance(item, dict)]
    return {
        "ok": True,
        **provider,
        "modelAvailable": provider["model"] in model_ids,
        "embeddingModelAvailable": provider["embeddingModel"] in model_ids,
        "models": model_ids,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        if os.environ.get("GRAPHITI_BRIDGE_LOG") == "true":
            super().log_message(format, *args)

    def do_GET(self) -> None:
        global _init_error
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)
        if path == "/health":
            _json(
                self,
                200 if _init_error is None else 503,
                {
                    "ok": _init_error is None,
                    "groupId": os.environ.get("GRAPHITI_GROUP_ID", "doppel-labs"),
                    "provider": _provider_status(),
                    "error": _init_error,
                },
            )
            return
        if path == "/llm/health":
            health = _llm_health()
            _json(self, 200 if health["ok"] else 503, health)
            return
        try:
            if path == "/entities":
                _json(self, 200, _list_entities(params))
                return
            if path == "/facts":
                _json(self, 200, _list_facts(params))
                return
            if path == "/evidence":
                result = _get_evidence(params)
                _json(self, 200 if result.get("ok") else 400, result)
                return
            if path == "/entity-context":
                result = _get_entity_context(params)
                _json(self, 200 if result.get("ok") else 400, result)
                return
            if path == "/timeline":
                result = _get_timeline(params)
                _json(self, 200 if result.get("ok") else 400, result)
                return
        except Exception as error:
            _init_error = str(error)
            _json(self, 500, {"error": str(error)})
            return
        _json(self, 404, {"error": "Not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            payload = _read_json(self)
            if path == "/episodes":
                _json(self, 202, _run(_add_episode(payload)))
                return
            if path == "/change-sets":
                _json(self, 202, _run(_apply_change_set(payload)))
                return
            if path == "/search":
                _json(self, 200, _run(_search(payload)))
                return
            _json(self, 404, {"error": "Not found"})
        except Exception as error:
            global _init_error
            _init_error = str(error)
            _json(self, 500, {"error": str(error)})


def main() -> None:
    host = os.environ.get("GRAPHITI_BRIDGE_HOST", "127.0.0.1")
    port = int(os.environ.get("GRAPHITI_BRIDGE_PORT", "8791"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Perry Graphiti bridge listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
