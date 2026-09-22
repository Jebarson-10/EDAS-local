# Released HSC 2026 output formats

Source files reviewed on 2026-09-09: Chief/Department, Custodian, Liaison
Officer and Route Officers duty lists from the Erode CEO office. These are
layout references for the Reports area; personal data from the examples is not
copied into application seeds.

## Common layout

- Landscape A4, Directorate of Government Examinations heading, examination
  title, month/year and Revenue District Name.
- One compact bordered table per duty list, serial number in the first column,
  multi-line officer details inside table cells, CEO signature area below.
- Print-ready pages use the formal list title, not developer report names.

## Chief Superintendent and Departmental Officer

Columns: S.No, Centre No., Name of the Centre, Chief Superintendent (name,
designation, school, mobile), Departmental Officer (same details).

For each timetable session marked for centre duty, the planner creates one Chief
and one Departmental Officer. It creates a second Departmental Officer only
when the centre's entered student strength is above 500. It also creates two
separate Office Staff duties per centre. Office Staff are kept out of teaching
and hall-invigilation selection; the official print layout for those two roles
has not yet been supplied.

## Custodian duty details

Columns: S.No, Name of Custodian Point, Custodian I, Contact Number, Custodian
II, Contact Number, No. of Exam Centres, No. of Routes; includes a total row.

The current planning count is one custodian for every ten active schools. This
is a staffing estimate, not a fabricated custodian-point allocation: the final
number may vary when eligible people are unavailable. Custodian points, routes
and the eligible-person list are still needed before names can be allotted to
this released layout.

## Liaison Officer duty details

Columns: Revenue District, Educational District, Collection Point, Special
Liaison Officer, Liaison Officer (First Year and Second Year), and Mark
Verification Officer (First Year and Second Year). Officer cells contain name,
designation, mobile number and school/address.

## Centre-wise route and Route Officers details

Columns: S.No, Custodian Point, Centre Number, Exam Centre Name, Route Number,
Route Officer Name, Collection Point No. and Name. Repeated custodian/route
cells are visually grouped.

## Data not yet modelled

Custodian points, collection points, route numbers, liaison assignments and the
official Office Staff report layout are separate operational data. They must be
entered/imported before the corresponding released forms can be generated. The
existing Theory reports now use the Chief/Departmental Officer centre-list
structure; the other forms are not fabricated until this source data exists.
