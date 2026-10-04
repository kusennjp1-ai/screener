"""Pure, bounded planning over an explicit cohort and verified source metadata.

This is a caller contract, not an evidence verifier or provider executor. See
``docs/financial-source-evidence/statement-refresh-planning.md`` before adapting
persisted records. In particular, cache timestamps are not acquisition receipts.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
import math
import re
from typing import Literal, Mapping, Sequence

from .financial_source_evidence import SOURCE_POLICY
from .security_master_service import security_master_resolver

MAX_BATCH_SIZE = 200
# Existing independent consumer policy: frontend/src/static/financialHistory.js.
FINANCIAL_HISTORY_TTL = timedelta(hours=72)
SOURCE_TTL = timedelta(milliseconds=SOURCE_POLICY["max_age_ms"])
PROOF_CONTRACT = "static-financial-current-v2"
HISTORY_CONTRACT = "financial_history"
STATEMENT_ATTRIBUTES = ("quarterly_income_stmt", "income_stmt")


@dataclass(frozen=True)
class VerifiedAcquisition:
    """An adapter's assertion after auditing a retained ORIGINAL source receipt."""

    symbol: str
    market: str
    contract: str
    receipt_id: str
    payload_sha256: str
    observed_at: datetime
    original_receipt_verified: bool = False
    identity_verified: bool = False
    contract_verified: bool = False


@dataclass(frozen=True)
class ProofStatus:
    """Aggregate ALL observations required by one EPS/sales gate, not a rating.

    ``expires_at`` is the earliest exact expiry returned by the existing proof
    verifier (source 7d, quarterly period 190d, annual period 550d). An absent
    source period requires a verified original receipt but has no valid proof.
    """

    state: Literal["gap", "proved", "nonpositive_proved", "source_period_missing"] = "gap"
    receipts: tuple[VerifiedAcquisition, ...] = ()
    expires_at: datetime | None = None
    recheck_after: datetime | None = None
    attributes: tuple[str, ...] = ("quarterly_income_stmt",)


@dataclass(frozen=True)
class HistoryStatus:
    """Annual-history structural validation is independent of EPS/sales proof.

    ``available`` means the required annual chain, currency and basis were
    validated by the history adapter. It does not mean positive growth.
    """

    state: Literal["gap", "available", "source_period_missing"] = "gap"
    receipt: VerifiedAcquisition | None = None
    recheck_after: datetime | None = None


@dataclass(frozen=True)
class SymbolStatus:
    eps: ProofStatus = field(default_factory=ProofStatus)
    sales: ProofStatus = field(default_factory=ProofStatus)
    annual_history: HistoryStatus = field(default_factory=HistoryStatus)
    quarantined_derived_rating: bool = False


@dataclass(frozen=True)
class AcquisitionAttempt:
    """Persist before acquisition; retain failures even when no payload exists.

    A retry needs a finite, explicitly chosen deadline strictly after this
    attempt. No deadline means a caller decision is required, never retry now.
    ``succeeded`` cannot erase unresolved gaps or certify any observation.
    """

    symbol: str
    attempt_id: str
    attempted_at: datetime
    outcome: Literal["succeeded", "failed", "source_period_missing", "in_flight", "provider_blocked"]
    retry_not_before: datetime | None = None
    http_status: int | None = None
    attributes: tuple[str, ...] = STATEMENT_ATTRIBUTES


@dataclass(frozen=True)
class ProviderResume:
    """Explicit recovery decision for exactly the last retained 403/429 stop."""

    blocked_attempt_id: str
    decided_at: datetime


@dataclass(frozen=True)
class ProviderStop:
    """Persist the global stop even if its symbol later leaves this cohort."""

    blocked_attempt_id: str
    stopped_at: datetime
    http_status: Literal[403, 429]
    retry_not_before: datetime | None = None


@dataclass(frozen=True)
class Requirement:
    target: str
    cause: str
    state: str = "ready"
    not_before: datetime | None = None
    due_since: datetime | None = None
    attributes: tuple[str, ...] = ()
    last_acquired_at: datetime | None = None


@dataclass(frozen=True)
class WorkItem:
    symbol: str
    requirements: tuple[Requirement, ...]
    last_serviced_at: datetime | None

    @property
    def ready_targets(self) -> tuple[str, ...]:
        return tuple(r.target for r in self.requirements if r.state == "ready")

    @property
    def attributes(self) -> tuple[str, ...]:
        needed = {attribute for r in self.requirements if r.state == "ready" for attribute in r.attributes}
        return tuple(attribute for attribute in STATEMENT_ATTRIBUTES if attribute in needed)


@dataclass(frozen=True)
class StatementRefreshPlan:
    eligible_symbols: tuple[str, ...]
    market: str
    evaluated_at: datetime
    required_valid_through: datetime
    eligible_count: int
    required_work: tuple[WorkItem, ...]
    batch: tuple[WorkItem, ...]
    cause_counts: Mapping[str, int]
    provider_state: str
    provider_not_before: datetime | None
    invalid_receipts: tuple[str, ...]
    next_wake_at: datetime | None

    @property
    def symbols(self) -> tuple[str, ...]:
        return tuple(item.symbol for item in self.batch)


def _clock(value: datetime, name: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be a timezone-aware datetime")
    return value.astimezone(timezone.utc)


def _receipt_clock(receipt: VerifiedAcquisition, symbol: str, market: str,
                   contract: str, now: datetime) -> datetime | None:
    if (not isinstance(receipt, VerifiedAcquisition)
            or receipt.symbol != symbol or receipt.market != market
            or receipt.contract != contract
            or receipt.original_receipt_verified is not True
            or receipt.identity_verified is not True or receipt.contract_verified is not True
            or not isinstance(receipt.receipt_id, str) or not receipt.receipt_id.strip()
            or not isinstance(receipt.payload_sha256, str)
            or not re.fullmatch(r"[a-f0-9]{64}", receipt.payload_sha256)):
        return None
    try:
        stamp = _clock(receipt.observed_at, "receipt.observed_at")
    except ValueError:
        return None
    return stamp if stamp <= now else None


def _deferred_missing(target: str, recheck: datetime | None, receipt_at: datetime,
                      now: datetime, attributes: tuple[str, ...]) -> Requirement:
    if recheck is None:
        return Requirement(target, f"{target}_source_period_missing", "retry_decision_required", attributes=attributes)
    recheck = _clock(recheck, "recheck_after")
    if recheck <= receipt_at:
        raise ValueError("recheck_after must be strictly after the original acquisition")
    return Requirement(target, f"{target}_source_period_missing",
                       "cooldown" if now < recheck else "ready", recheck, attributes=attributes)


def _provider_gate(attempts: Sequence[AcquisitionAttempt], resume: ProviderResume | None,
                   stop: ProviderStop | None, now: datetime) -> tuple[str, datetime | None]:
    blocked = [(a.attempted_at, a.attempt_id, a.retry_not_before) for a in attempts
               if a.outcome == "provider_blocked" or a.http_status in (403, 429)]
    if stop is not None:
        stamp = _clock(stop.stopped_at, "provider_stop.stopped_at")
        if (not isinstance(stop.blocked_attempt_id, str) or not stop.blocked_attempt_id.strip()
                or type(stop.http_status) is not int or stop.http_status not in (403, 429) or stamp > now):
            raise ValueError("Invalid retained provider stop")
        if stop.retry_not_before is not None:
            if _clock(stop.retry_not_before, "provider_stop.retry_not_before") <= stamp:
                raise ValueError("Provider cooldown must be after the blocked attempt")
        blocked.append((stamp, stop.blocked_attempt_id, stop.retry_not_before))
    by_id: dict[str, tuple] = {}
    for event in blocked:
        if event[1] in by_id and by_id[event[1]] != event:
            raise ValueError("Conflicting metadata for the same blocked attempt")
        by_id[event[1]] = event
    if not blocked:
        if resume is not None:
            raise ValueError("Provider resume must bind a retained blocked attempt")
        return "available", None
    _, blocked_id, deadline = max(blocked, key=lambda item: (item[0], item[1]))
    if deadline is None:
        return "provider_retry_decision_required", None
    if now < deadline:
        return "provider_cooldown", deadline
    if resume is None or resume.blocked_attempt_id != blocked_id:
        return "provider_resume_required", deadline
    decided = _clock(resume.decided_at, "provider_resume.decided_at")
    if not deadline <= decided <= now:
        return "provider_resume_required", deadline
    return "available", None


def plan_statement_refresh(*, eligible_symbols: Sequence[str], market: str,
                           statuses: Mapping[str, SymbolStatus],
                           attempts: Sequence[AcquisitionAttempt], now: datetime,
                           batch_limit: int = MAX_BATCH_SIZE,
                           provider_resume: ProviderResume | None = None,
                           provider_stop: ProviderStop | None = None,
                           refresh_through: datetime | None = None) -> StatementRefreshPlan:
    """Return a deterministic required-work queue and at most 200 ready symbols.

    The cohort is already eligibility-filtered and canonical, for one market.
    Missing statuses mean unknown, never zero. Foreign/duplicate input identities
    are rejected instead of silently expanding, rewriting or dropping scope.
    Persist actual attempts/results between calls; planning alone advances no
    cursor. Full required_work includes deferred gaps for honest coverage counts.
    An explicit ``refresh_through`` can include work expiring before the next
    scheduled run, without changing any evidence freshness threshold.
    """
    now = _clock(now, "now")
    horizon = now if refresh_through is None else _clock(refresh_through, "refresh_through")
    if horizon < now:
        raise ValueError("refresh_through cannot precede evaluation time")
    if type(batch_limit) is not int or not 1 <= batch_limit <= MAX_BATCH_SIZE:
        raise ValueError("batch_limit must be an integer in [1, 200]")
    if not isinstance(market, str) or not market or security_master_resolver.normalize_market(market) != market:
        raise ValueError("market must be canonical")
    cohort = tuple(eligible_symbols)
    if any(not isinstance(s, str) or not s or s != s.strip().upper() for s in cohort):
        raise ValueError("eligible_symbols must contain canonical symbols")
    cohort_set = set(cohort)
    if len(cohort_set) != len(cohort):
        raise ValueError("Duplicate eligible symbol")
    for symbol in cohort:
        identity = security_master_resolver.resolve_identity(symbol=symbol)
        if (identity.canonical_symbol, identity.market) != (symbol, market):
            raise ValueError(f"Noncanonical eligible symbol: {symbol}")
    if set(statuses) - cohort_set or any(a.symbol not in cohort_set for a in attempts):
        raise ValueError("Metadata contains symbols outside the eligible cohort")
    latest_attempts: dict[str, AcquisitionAttempt] = {}
    attempts_by_symbol: dict[str, list[AcquisitionAttempt]] = {}
    ids: set[str] = set()
    for attempt in attempts:
        if (not isinstance(attempt.attempt_id, str) or not attempt.attempt_id.strip()
                or attempt.attempt_id in ids):
            raise ValueError("Attempt IDs must be nonempty and unique")
        ids.add(attempt.attempt_id)
        if attempt.http_status is not None and (type(attempt.http_status) is not int or not 100 <= attempt.http_status <= 599):
            raise ValueError("HTTP status must be an integer response status")
        stamp = _clock(attempt.attempted_at, "attempted_at")
        if stamp > now or attempt.outcome not in {
            "succeeded", "failed", "source_period_missing", "in_flight", "provider_blocked"
        }:
            raise ValueError("Invalid attempt time or outcome")
        if (not attempt.attributes
                or tuple(a for a in STATEMENT_ATTRIBUTES if a in attempt.attributes) != attempt.attributes):
            raise ValueError("Attempt attributes must be a nonempty canonical statement subset")
        attempts_by_symbol.setdefault(attempt.symbol, []).append(attempt)
        if attempt.retry_not_before is not None:
            if _clock(attempt.retry_not_before, "retry_not_before") <= stamp:
                raise ValueError("retry_not_before must be strictly after attempted_at")
        previous = latest_attempts.get(attempt.symbol)
        if previous is None or (stamp, attempt.attempt_id) > (previous.attempted_at, previous.attempt_id):
            latest_attempts[attempt.symbol] = attempt
    provider_state, provider_not_before = _provider_gate(attempts, provider_resume, provider_stop, now)
    counts: Counter[str] = Counter()
    invalid: list[str] = []
    work: list[WorkItem] = []
    future_deadlines: list[datetime] = []
    if provider_not_before is not None and provider_not_before > now:
        future_deadlines.append(provider_not_before)

    for symbol in sorted(cohort):
        status = statuses.get(symbol, SymbolStatus())
        requirements: list[Requirement] = []
        acquired: list[datetime] = []
        for target, proof in (("eps", status.eps), ("sales", status.sales)):
            if proof.state not in {"gap", "proved", "nonpositive_proved", "source_period_missing"}:
                raise ValueError("Unknown proof state")
            if (not proof.attributes or tuple(a for a in STATEMENT_ATTRIBUTES if a in proof.attributes) != proof.attributes):
                raise ValueError("Proof acquisition attributes must be a nonempty canonical statement subset")
            stamps = [_receipt_clock(r, symbol, market, PROOF_CONTRACT, now) for r in proof.receipts]
            valid_receipts = bool(stamps) and all(stamp is not None for stamp in stamps)
            if any(stamp is None for stamp in stamps):
                invalid.append(f"{symbol}:{target}")
            acquired.extend(stamp for stamp in stamps if stamp is not None)
            expiry = _clock(proof.expires_at, "proof.expires_at") if proof.expires_at else None
            source_expiry = min(stamps) + SOURCE_TTL if valid_receipts else None
            proof_valid = (valid_receipts and expiry is not None
                           and max(stamps) <= expiry <= source_expiry)
            if proof.state in {"proved", "nonpositive_proved"} and proof_valid and now <= expiry:
                if proof.state == "nonpositive_proved":
                    counts[f"{target}_nonpositive_proved"] += 1
                if refresh_through is not None and expiry <= horizon:
                    requirements.append(Requirement(target, f"{target}_proof_expiring", due_since=expiry,
                                                    attributes=proof.attributes, last_acquired_at=min(stamps)))
            elif proof.state == "source_period_missing" and valid_receipts:
                requirements.append(_deferred_missing(target, proof.recheck_after, max(stamps), now, proof.attributes))
            else:
                requirements.append(Requirement(target, f"{target}_proof_gap",
                                                due_since=expiry if proof_valid else None, attributes=proof.attributes,
                                                last_acquired_at=min(stamps) if valid_receipts else None))

        history = status.annual_history
        if history.state not in {"gap", "available", "source_period_missing"}:
            raise ValueError("Unknown annual history state")
        stamp = (_receipt_clock(history.receipt, symbol, market, HISTORY_CONTRACT, now)
                 if history.receipt is not None else None)
        if history.receipt is not None and stamp is None:
            invalid.append(f"{symbol}:annual_history")
        if stamp is not None:
            acquired.append(stamp)
        if history.state == "source_period_missing" and stamp is not None:
            requirements.append(_deferred_missing("annual_history", history.recheck_after, stamp, now, STATEMENT_ATTRIBUTES))
        elif history.state != "available" or stamp is None:
            requirements.append(Requirement("annual_history", "annual_history_acquisition_gap", attributes=STATEMENT_ATTRIBUTES))
        elif now > stamp + FINANCIAL_HISTORY_TTL:
            requirements.append(Requirement("annual_history", "annual_history_expired",
                                            due_since=stamp + FINANCIAL_HISTORY_TTL, attributes=STATEMENT_ATTRIBUTES,
                                            last_acquired_at=stamp))
        elif refresh_through is not None and stamp + FINANCIAL_HISTORY_TTL <= horizon:
            requirements.append(Requirement("annual_history", "annual_history_expiring",
                                            due_since=stamp + FINANCIAL_HISTORY_TTL, attributes=STATEMENT_ATTRIBUTES,
                                            last_acquired_at=stamp))
        if status.quarantined_derived_rating:
            counts["quarantined_derived_rating"] += 1
        attempt = latest_attempts.get(symbol)
        adjusted: list[Requirement] = []
        for requirement in requirements:
            counts[requirement.cause] += 1
            state, deadline = requirement.state, requirement.not_before
            # An old successful attempt must not suppress a NEW expiry. A
            # failure/partial result with unresolved gaps needs a retry decision.
            relevant = [a for a in attempts_by_symbol.get(symbol, ()) if set(a.attributes).intersection(requirement.attributes)]
            target_attempt = max(relevant, key=lambda a: (a.attempted_at, a.attempt_id), default=None)
            newly_due = (target_attempt is not None and target_attempt.outcome == "succeeded"
                         and requirement.due_since is not None
                         and requirement.due_since > target_attempt.attempted_at
                         and requirement.last_acquired_at is not None
                         and requirement.last_acquired_at >= target_attempt.attempted_at)
            if target_attempt is not None and not newly_due:
                if target_attempt.retry_not_before is None:
                    state, deadline = "retry_decision_required", None
                elif now < target_attempt.retry_not_before:
                    state = "cooldown"
                    deadline = max(d for d in (deadline, target_attempt.retry_not_before) if d is not None)
            if deadline is not None and deadline > now:
                future_deadlines.append(deadline)
            if provider_state != "available":
                state = "provider_stopped"
            adjusted.append(Requirement(requirement.target, requirement.cause, state, deadline,
                                        requirement.due_since, requirement.attributes, requirement.last_acquired_at))
        if adjusted:
            serviced = acquired + ([attempt.attempted_at] if attempt is not None else [])
            work.append(WorkItem(symbol, tuple(adjusted), max(serviced) if serviced else None))
    # Never-serviced symbols first, then least recently serviced. Original
    # receipts and real attempts advance rotation; cache rewrites cannot do so.
    oldest = datetime.min.replace(tzinfo=timezone.utc)
    work.sort(key=lambda item: (item.last_serviced_at or oldest, item.symbol))
    ready = tuple(item for item in work if item.ready_targets)
    return StatementRefreshPlan(
        tuple(sorted(cohort)), market, now, horizon, len(cohort), tuple(work), ready[:batch_limit], dict(sorted(counts.items())),
        provider_state, provider_not_before, tuple(invalid),
        min(future_deadlines) if future_deadlines else None,
    )


def export_statement_batch_plan(plan: StatementRefreshPlan, *, base_artifact_sha256: str,
                                source_data_as_of: str,
                                batch_allowlist: Sequence[str]) -> dict:
    """Bind the pure plan to the collector's explicit artifact/allowlist envelope.

    The collector must independently hash the base bytes and verify its as-of
    date and US cohort. A hash-shaped string alone is not acquisition authority.
    This helper neither reads the artifact nor executes any selected work.
    """
    if plan.market != "US":
        raise ValueError("This collector envelope supports a verified US cohort only")
    required_through = _clock(plan.required_valid_through, "required_valid_through")
    if required_through < plan.evaluated_at:
        raise ValueError("Required validity cannot precede plan evaluation")
    if not isinstance(base_artifact_sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", base_artifact_sha256):
        raise ValueError("base_artifact_sha256 must be a lowercase SHA-256 digest")
    if not isinstance(source_data_as_of, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", source_data_as_of):
        raise ValueError("source_data_as_of must be an ISO day")
    as_of = date.fromisoformat(source_data_as_of)
    if as_of > plan.evaluated_at.date():
        raise ValueError("source_data_as_of cannot be in the future")
    allowlist = tuple(batch_allowlist)
    if (len(allowlist) > MAX_BATCH_SIZE or len(set(allowlist)) != len(allowlist)
            or set(allowlist) - set(plan.eligible_symbols)):
        raise ValueError("batch_allowlist must be a unique <=200-symbol subset of the exact cohort")
    if (len(plan.batch) > MAX_BATCH_SIZE or len(set(plan.symbols)) != len(plan.symbols)
            or set(plan.symbols) - set(allowlist)):
        raise ValueError("Selected symbols must be a unique <=200-symbol subset of the allowlist")
    if plan.provider_state != "available" and plan.batch:
        raise ValueError("A stopped provider cannot export selected work")
    selected = []
    for item in plan.batch:
        targets = set(item.ready_targets)
        if not targets or targets - {"eps", "sales", "annual_history"}:
            raise ValueError("Selected work must have supported ready requirements")
        if not item.attributes or any(set(r.attributes) - set(STATEMENT_ATTRIBUTES) for r in item.requirements):
            raise ValueError("Selected work must use bounded statement attributes")
        minimum_ttl = min(FINANCIAL_HISTORY_TTL if "annual_history" in targets or attribute == "income_stmt"
                          else SOURCE_TTL for attribute in item.attributes)
        if required_through - plan.evaluated_at > minimum_ttl:
            raise ValueError("Required validity exceeds the selected acquisition policy")
        selected.append({"symbol": item.symbol, "attributes": list(item.attributes),
                         "targets": list(item.ready_targets)})
    return {
        "schema_version": "financial-statement-batch-plan-v1",
        "verified_us_cohort": {"symbols": list(plan.eligible_symbols),
                               "base_artifact_sha256": base_artifact_sha256},
        "batch_allowlist": list(allowlist),
        "evaluation_time": plan.evaluated_at.isoformat().replace("+00:00", "Z"),
        "required_valid_through": required_through.isoformat().replace("+00:00", "Z"),
        "source_data_as_of": source_data_as_of,
        "selected": selected,
    }


def statement_refresh_capacity(eligible_count: int, *, batch_limit: int = MAX_BATCH_SIZE,
                               batches_per_day: int,
                               bounded_run_budget: timedelta = timedelta(0)) -> dict:
    """Nominal capacity only, assuming successful acquisitions and availability."""
    if type(eligible_count) is not int or eligible_count < 0:
        raise ValueError("eligible_count must be a nonnegative integer")
    if type(batch_limit) is not int or not 1 <= batch_limit <= MAX_BATCH_SIZE:
        raise ValueError("batch_limit must be an integer in [1, 200]")
    if type(batches_per_day) is not int or batches_per_day < 0:
        raise ValueError("batches_per_day must be a nonnegative integer")
    if not isinstance(bounded_run_budget, timedelta) or bounded_run_budget < timedelta(0):
        raise ValueError("bounded_run_budget must be a nonnegative timedelta")
    daily = batch_limit * batches_per_day
    batches = math.ceil(eligible_count / batch_limit)
    cycle_hours = batches * 24 / batches_per_day if batches_per_day else (0 if not batches else None)
    budget_hours = None if cycle_hours is None else cycle_hours + bounded_run_budget.total_seconds() / 3600
    ttl_days = FINANCIAL_HISTORY_TTL.total_seconds() / 86400
    return {
        "eligible_count": eligible_count,
        "bootstrap_batches": batches,
        "nominal_symbols_per_day": daily,
        "required_average_symbols_per_day": eligible_count / ttl_days,
        "nominal_cycle_hours": cycle_hours,
        "cycle_budget_hours": budget_hours,
        "nominal_capacity_within_history_ttl": budget_hours is not None and budget_hours < ttl_days * 24,
        "guaranteed_coverage": False,
    }
