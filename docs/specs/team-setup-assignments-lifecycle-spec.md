# Team Setup Assignments Lifecycle Spec

## Status
Draft implementation spec aligned to the post-refactor Assignments workflow.

## Scope
This spec defines Team Setup > Assignments behavior for:
- Month and shift-scoped browsing
- Assignment creation
- Assignment edit (main entry and history entry)
- Assignment row ordering
- Assignment removal

This spec is chart-scoped.

## Definitions
- **Assignment entry**: effective-dated row in `dbo.ChartUserTypes`.
- **Main assignment row**: the row rendered in the Assignments main table for the selected shift and month window.
- **Assignment change row**: a historical effective-dated row shown in the expandable changes table.
- **Active for month**: an assignment overlaps the selected month range where `StartDate <= monthEnd` and `(EndDate IS NULL OR EndDate >= monthStart)`.

## List View
Controls:
- Month picker (required, no `None` option).
- Shift picker (options constrained to shifts active in selected month).

Rules:
1. Shift options are populated from the selected month's available shifts.
2. If month changes and current shift is no longer valid, shift selection clears.
3. Add button is disabled until a valid shift is selected.
4. Disabled Add button explains that a valid shift selection is required.

Main table columns:
- Reorder handle
- User
- Start Date
- End Date
- Changes
- Edit action

Empty states:
- No shifts for month: show month-level no-shifts message.
- No valid shift selected: show valid-shift-required message.
- Valid shift selected with no assignments: show no-assignments message.

## Assignment Add/Edit View
Fields:
- User combobox
- Start date (`Change Effective` label while editing)
- End date (nullable, indefinite when empty)

Removed fields:
- Shift picker in form
- Sort order field

Shift binding:
- Add flow inherits shift from list view selection.
- Edit flow uses the existing row's shift unless changed through edit semantics.

Validation:
- User is required.
- Start date is required.
- End date is optional.
- If provided, `EndDate >= StartDate`.

## Effective-Dated Behavior
Create/effective edit follows timeline surgery semantics per user:
1. Locate containing row at effective date and next row after effective date.
2. End containing row at `effectiveStart - 1 day` when needed.
3. Insert or update effective row at requested start.
4. If explicit end date is not supplied, use natural end derived from next start date.
5. Reject if resulting end date would overlap/meet next change boundary.

History edit (`editMode=history`):
- Targets a specific historical row by `changeStartDate`.
- Allows moving the row start date within neighboring change boundaries.
- Applies requested shift/start/end updates while preserving timeline consistency.

## Ordering
Main-table drag reorder is enabled in list view.

Write model:
- Reorder applies to assignment rows for the selected shift and selected month window.
- API request includes selected `month` and ordered assignment IDs.
- Backend validates payload includes exactly the assignment IDs active for that shift/month window.
- Backend persists `DisplayOrder` updates transactionally.

## Remove Behavior
From assignment edit views:
- Main edit remove: timeline remove for the selected user (active rows end today; future rows soft-deleted).
- History edit remove: removes only targeted historical entry.

## API Contract Notes
`GET /api/team/assignments`:
- Accepts `month=YYYY-MM` for overlap-window queries.
- Supports `asOf=YYYY-MM-DD` fallback for point-in-time compatibility.

`PATCH /api/team/assignments` reorder path:
- `reorderOnly: true`
- Requires `shiftEmployeeTypeId`, `month`, and `orderedAssignmentIds`.
- `asOf` accepted as compatibility fallback to derive month when `month` is omitted.

## Transaction and Enforcement Requirements
- All assignment mutations run in DB transactions.
- Server-side validation is authoritative.
- Timeline overlap constraints are enforced server-side.
