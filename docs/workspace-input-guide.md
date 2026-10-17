# Inputs for the new examination cycle

Use Import data → Download input template. It contains instructions and eight
input sheets. Your original School Master and Teacher Master files can also be
uploaded directly, including their title row above the headings. All original
master columns are retained with each record; recognised fields drive allotment.

Import data also has separate upload buttons and templates for each category.
Use Upload School Master first and Upload Teacher Master second. Timetable has
its own navigation tab and bulk upload. Exam details provides bulk entry for
centres, points, routes, practical groups and optional history. No individual
student roster is needed: theory uses centre totals, practical uses group totals.

For a 13A PDF, use Upload centre-strength PDF. Check all school selections and
counts, including linked schools, before selecting Save reviewed centres. The
school selector shows the full master school name followed by its numeric UDISE
code. Exam-school codes printed in the PDF are a different coding system and must
not be entered as UDISE. An unrecognised school name requires a manual link.

High school means education through 10th; Higher secondary means through 12th.
This school level does not by itself declare the school an exam centre. A higher
secondary school can also host an SSLC centre when the centre input says so.
Staff ID is the existing identifier in Teacher Master, not a second employee code.

| Sheet | Information to enter |
|---|---|
| Schools | UDISE Code, School Name, Block, Educational District, Category, Management Type, Latitude, Longitude |
| Staff | UDISE Code, Staff ID, Staff NAME, Type of Staff, Designation, Appointed Subject, Handling Subject1–6, Class Taught, Date Of Join, Date of present post |
| Centres | Standard, Centre Code, UDISE Code, Students, Clubbed UDISE Codes |
| Timetable | Standard, Exam Date, Session, Subject, Centre Code |
| Points | Standard, Point ID, Point Type, Point Name, UDISE Code, Centre Codes |
| Routes | Standard, Route ID, Custodian Point ID, Centre Codes |
| Practical | Standard, Demand ID, UDISE Code, Subject, Students, Student Group, Receiving UDISE Code, Allowed Clubbed UDISE Codes, Available Halls, Exam Dates |
| Previous Duties | Staff ID, Duty School UDISE Code, Duty Date, Duty |

## Filling the sheets

- School UDISE and staff ID are identifiers. They may be Excel text or numbers.
  Preserve any leading zeros by using text. Do not substitute a centre code for UDISE.
- A school becomes a centre only through its Centres row. Enter separate rows
  for 10th and 12th when the same school serves both examinations.
- Category must clearly identify High or Higher Secondary; original School
  Master's numbered categories are recognised. Management must identify
  Government, aided or private. Unrecognised management needs correction.
- Date of present post determines seniority. Date Of Join is retained separately.
  Invalid years are reported and left unusable, never silently corrected.
- Class Taught must include 10 for a 10th practical examiner; Handling Subject
  must actually include Science. Merely being a BT Assistant is not enough.
- Standard is 10 or 12. Session is MORNING or AFTERNOON. Dates may be Excel dates,
  DD/MM/YYYY or YYYY-MM-DD. Practical date lists use YYYY-MM-DD separated by semicolons.
- A blank timetable Centre Code applies to all centres of its standard. Otherwise
  the timetable row applies only to the specified centre.
- Point Type is CUSTODIAN or COLLECTION. Enter the required number of points
  (four custodians is the suggested starting count). Every centre must belong to
  exactly one custodian point. Route centre lists must belong to their chosen point.
- Separate lists of centre codes and UDISE codes with semicolons.
- Practical has one row per school, student group and paper. Use the same student
  group and student count for papers taken by the same students; different groups
  must represent different students. List all available practical dates.
- Available Halls means rooms for that subject at the receiving school, not
  theory halls. Keep the count consistent for that receiving school and subject.
- For a practical group below 15, manually select a receiving school from the
  entered clubbed choices, within the same educational district. The receiving
  location is shared; origin-school groups and their internal examiners remain
  separately identifiable in the report.
- Previous Duties is optional input for the two-year exclusion. No previous
  cycle is consulted by default. A completely empty history cannot prove that
  staff did not serve at a centre previously; import verified history if required.
- Unknown post names are preserved, not automatically treated as PG, BT, HM or
  office staff. Supply DEO staff explicitly; the app does not invent officers.

## What the supplied master files provide

The checked School Master contains 416 schools, 14 blocks and five educational
districts. Teacher Master contains 14,151 staff records, all matching school UDISE
codes. These are import-analysis counts, not bundled sample data.

Five source date values have invalid years. Teacher Master Excel rows 1156 and
2877 need Date Of Join correction; rows 3632, 7056 and 10366 need Date of
present post correction. Recheck against the original file if rows are moved.
Fourteen present-post dates are unusable in total: three invalid and eleven
blank/Null values. The source parser reports the exact affected rows; source
values remain retained. No personal names or source rows are included in this repository.

The masters alone do not supply examination centre codes and student strengths,
the official timetable, custodian/collection point coverage, routes, practical
groups and room availability, or verified past duties. Fill these from official
inputs rather than inventing values. Coordinates being present does not establish
that they are geographically accurate; review source coordinates before allotment.

## Reports and preservation

Theory reports group chief, departmental officers, invigilators, backups and
JA/OA staff by centre. A second sheet lists custodian, liaison, route and squad
officers. The optional chief/department download excludes other roles.
Practical reports include internal and external names, subject, batch, student
count, date and session. Each generation stores a separate input snapshot.
Editing today's master does not change an old download's names or data.

Back up before installing updates. A new cycle is a fresh workspace, not a
command to erase historical cycles. A backup restore creates a separate cycle.
