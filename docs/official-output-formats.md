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

## Custodian duty details

Columns: S.No, Name of Custodian Point, Custodian I, Contact Number, Custodian
II, Contact Number, No. of Exam Centres, No. of Routes; includes a total row.

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

Custodian points, collection points, route numbers and liaison assignments are
separate operational data. They must be entered/imported before the corresponding
released forms can be generated. The existing Theory reports now use the
Chief/Departmental Officer centre-list structure; other three forms are not
fabricated until this source data exists.
