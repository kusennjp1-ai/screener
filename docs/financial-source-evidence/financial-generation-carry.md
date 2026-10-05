# Advancing a price build with an existing financial source generation

`frontend/tools/financial-generation-carry.mjs` implements the separate
`financial-generation-carry-v1` destination contract. It does not relax
`export_statement_projection.py`, `verify_target_base`, or the strict
`financial-statement-projection-v1` correction validator. A same-price
correction must still prove identical full price/date/universe semantics.

The release controller verifies the active certified lineage, preserves the
original projection and original target base in immutable `financial-lineage`
assets, and calls `createFinancialGenerationCarry` with:

- `sourceProjection`, `sourceProjectionSha256`: original correction/native
  projection JSON bytes (UTF-8 string or Buffer) and exact SHA256.
- `sourceBase`, `sourceBaseSha256`: its original target-base JSON bytes and hash.
  The original projection must bind this exact base.
- `sourceLineage`: the controller-verified stable financial-source lineage hash.
- `previousPublicationIdentity`: exact predecessor run/attempt/receipt/manifest
  identity.
- `targetBase`, `targetBaseSha256`: the complete fresh baseline's JSON bytes and
  exact hash. The market is US; every row has a unique symbol and matching date.
- `evaluatedAt`: the actual current build instant, never the old source clock.

The returned carry artifact embeds those exact input bytes and binds every
output by a distinct `financial_generation` digest. Its `bindings` retain the
stable source lineage, previous publication identity, and all input hashes;
`source_financial_generation`, original policy, receipt inventory and inventory
hash remain inspectable. `validateFinancialGenerationCarry` reconstructs the
whole artifact and rejects any changed key, value, receipt, or claim. The
controller supplies the independently verified expected lineage and input
hashes; a digest asserted by an untrusted caller is not certification authority.

Every symbol in the current price universe gets an explicit financial owner.
A retained row needs matching market/symbol and at least one matching issuer
name or identifier, with no conflicting supplied names, types, or identifiers.
Name matching normalizes Unicode, case and whitespace; CIK matching normalizes
leading zeroes; nonzero numeric CIK and valid CUSIP/ISIN check digits are required
for identifier-only continuity. Bare tickers and exact placeholder display names
do not establish continuity. Original base and projection identity contexts are
both retained for conflict checks. This is bounded continuity evidence, not independent proof that
price series and financial receipts belong to the same legal issuer. Existing
issuer-identity limitations remain unchanged. Added, unacquired, conflicting,
or ticker-only identities get null financial values, empty history, no source
receipts and explicit unknown reasons. They never inherit current claims from
legacy scalars, a provider-looking timestamp, or a fresh unowned proof in the
price export. Removed price symbols need not remain in the current universe.

Retained source cells, currencies, proof tuples, original proof evaluation
instant, receipt clocks, source evidence and history cells remain unchanged.
Only destination as-of fields change. Existing current-field and history
consumers evaluate freshness at the actual build instant. A stale quarterly
source can therefore become unknown while a current annual source remains
usable, and vice versa. Expired original evidence stays in the audit; it does
not regain availability. A newly acquired receipt requires a separately
verified, typed source-generation activation with a different lineage.

The exporter accepts these complete, mutually exclusive opt-in variables:

```
FINANCIAL_GENERATION_CARRY_PROJECTION=/absolute/path/carry.json
FINANCIAL_GENERATION_CARRY_SHA256=<exact carry file hash>
FINANCIAL_GENERATION_CARRY_SOURCE_LINEAGE=<verified stable lineage hash>
FINANCIAL_GENERATION_CARRY_PREVIOUS_IDENTITY=<run/attempt/receipt/manifest>
FINANCIAL_GENERATION_CARRY_TARGET_BASE_SHA256=<fresh full baseline hash>
FINANCIAL_EVALUATED_AT=<actual current build instant>
```

It uses the existing fanout to current research rows, details, all chart aliases,
scan rows, history, method assessments, portfolio and workbench outputs. The
standalone audit stays out of compact per-row transport.
`verifyCarryCompatibility({root, carry, evaluatedAt})` validates all these
surfaces in both the build quality gate and release controller, and rejects any current claim that expires between build and release
verification, including annual-only or quarterly-only history expiry.

For ordinary daily builds, first create the fresh baseline without recording
its candidate snapshot, then run the carried export, verify financial-only
changes against that baseline, and record the final carried daily snapshot.
The preceding published history remains immutable. The fresh baseline updates
price-derived performance; carry does not freeze the previous day's price
bundle or revive an earlier daily financial observation.

Targeted verification:

```
cd frontend
npx vitest run tools/financial-generation-carry.test.mjs tools/financial-correction-overlay.test.mjs
```

The helper never calls a provider, converts FX, rebuilds the original archive,
renews source timestamps, or authorizes publication.
