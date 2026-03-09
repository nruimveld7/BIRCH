# Team Setup Shifts Lifecycle Spec

## Status
Draft implementation spec based on product decisions captured in discussion.

## Scope
This spec defines Team Setup > Shifts behavior for:
- Shift creation
- Shift edit (main entries and edit entries)
- Shift name change behavior
- Shift ordering by month
- Shift removal

This spec is schedule-scoped.

## Definitions
- **Main shift entry**: canonical row representing a shift identity.
- **Shift edit entry**: effective-dated override/change row for a shift.
- **Active for month**: a shift is active for a month if the month range overlaps `[StartDate, EndDate]`, where `EndDate = NULL` means open-ended.
- **Single-day interval**: `StartDate == EndDate`, explicitly valid.
- **Soft-deleted shift**: historical shift row not active for current use; must have non-NULL end date.
- **HasEverBeenInUse**: true when the shift has had assigned employees at any point such that it would have appeared on schedule with assignment coverage.

## Naming and Uniqueness
- Only display-name uniqueness matters.
- Matching is exact string match (case-sensitive).
- Within a schedule scope, two shifts with the same name must not both be active for overlapping time.
- Historical duplicate identities for the same name are not allowed; creation must reinstate existing soft-deleted identity when applicable.

## Create Shift
Inputs:
- `Name` (required)
- `PatternId` (nullable)
- `StartDate` (required)
- `EndDate` (nullable)

Validation:
- Reject when `EndDate < StartDate`.

Behavior:
1. Check for active overlap conflict by exact name.
2. If conflict exists, reject with validation error.
3. If no active conflict and a soft-deleted shift with same name exists:
   - Reinstate existing shift identity.
   - Apply all fields from current UI input (do not preserve prior pattern/date values).
4. If no matching soft-deleted shift exists, create new shift.

Order side effect:
- Creating a shift registers an order change at the shift start month.
- New shift is appended to end of list for that month snapshot.

## Edit Shift: Non-Name Changes (Type A)
Editable fields:
- Pattern
- Change Effective Date (start)
- End date

Rule:
- Editing creates/updates effective-dated shift edit entries.
- Overlaps must be resolved deterministically by interval surgery.

For each overlapping existing edit interval against new interval `[Nstart, Nend]`:
1. No overlap: no change.
2. New fully covers existing: remove existing edit.
3. New overlaps left edge of existing: set existing start to `Nend + 1 day`.
4. New overlaps right edge of existing: set existing end to `Nstart - 1 day`.
5. New strictly inside existing: split existing into two edits around new interval.

Single-day interval handling (`Nstart == Nend`):
- If on existing start day: single-day entry persists; existing starts next day.
- If on existing end day: single-day entry persists; existing ends previous day.
- If in middle: existing splits into two around single day.

Multiple conflicts:
- Apply the same rules independently to each overlapping entry in one transaction.

End-date cleanup rule:
- If resulting edit applies an end date, hard-delete shift-scoped items dated after end date (assignments/events/other future shift changes for that shift scope).

Edit-of-edit:
- Editing an existing edit uses the same Type A conflict resolution rules.

## Edit Shift: Name Change (Type B)
If new name differs exactly from old name:
1. Create/reinstate a target shift using Create rules.
   - `Change Effective` acts as new shift start.
   - Pattern/end-date fields come from current UI state.
2. End old shift at `ChangeEffectiveDate - 1 day`.
3. Move all shift-scoped records from old shift to new shift for dates `>= ChangeEffectiveDate`, including:
   - Assignments
   - Shift-scoped events
   - Shift change/edit rows
   - Other shift-scoped entities tied to old shift identity
4. If an end date is supplied in this edit for the new shift, hard-delete shifted items after that end date.

If new name equals old name exactly:
- Downgrade to Type A behavior.

## Special Edit Case: Change Effective Before Old Main Start
When `ChangeEffectiveDate < oldMainStart`:
1. Update main shift start to new start.
2. If pattern changed:
   - Main entry takes new pattern.
   - Add edit entry to restore initial/original pattern beginning at previous start date.
3. End date handling in same edit:
   - If new end date is before old end date:
     - Main reflects edited range.
     - Prior main behavior is represented as edit from day after new end date through old end date.
   - If new end date is after old end date:
     - Existing main period is represented as change over its prior start/end.
     - Edited entry becomes primary and extends coverage.
4. General edge rule:
   - If edit end date is after previous main end date, update main end date to the edit end date.

## Shift Ordering by Month
Team Setup > Shifts ordering is effective-dated by month.

Behavioral model:
- A month row exists only if order changed in that month.
- Reading order for month `M`:
  1. Use exact row for `M` if present.
  2. Else use latest row prior to `M`.
  3. Else use default deterministic base order.

Write rules:
- Reorder action in month `M` inserts row if absent, or updates row in place if present.
- Reorder applies to month `M` and all later months via fallback inheritance.
- If editing modifies a primary entry start date, register order change at that new start month and place shift at end.
- If shift is removed/soft-deleted, register order change in effective removal month removing shift from order.

## Remove Behavior
### Remove while editing an edit entry
- Hard-delete the edit entry immediately.
- No attempt to auto-fill or merge neighboring edits.

### Remove while editing a main shift
1. Compute `HasEverBeenInUse`.
2. If false:
   - No confirmation prompt.
   - Hard-delete main shift and related data.
3. If true:
   - Show destructive confirmation prompt with cancel path.
   - On confirm, execute the same hard-delete behavior.

Hard-delete scope for main shift remove:
- Main shift row
- All shift edit rows
- Shift-scoped events
- Assignments
- User-scoped events for assigned users during assignment ranges
- Order references/snapshots updated so removed shift no longer appears

## Transaction and Enforcement Requirements
- All mutating operations must run in DB transactions.
- Server-side validation/enforcement is authoritative (UI checks are advisory UX).
- Date overlap and uniqueness checks must be performed server-side to prevent race-condition duplicates.

## Suggested Storage for Monthly Order
Use a new schedule-scoped monthly order table (or equivalent) that stores order snapshots only for changed months.
- Key concept: one snapshot per changed month per schedule.
- Snapshot payload may be normalized rows or ordered ID list, as long as deterministic reconstruction is supported.

## Open Implementation Notes
- Tie-breaker order should be deterministic when fallback/default order is used.
- Bulk move/delete behavior for downstream shift-scoped entities should be implemented centrally to avoid drift across actions.
