# Client sample formats (layout only)

Officers uploaded current manual workbooks/letters (March 2026 cycle).  
**This document records field layouts only.** Real names, mobiles, and school rolls from those files are **not** stored in the repository (AGENTS.md: synthetic fixtures only).

Samples remain outside git (agent uploads / `.data/`). Do not commit client PII.

## Catalog

| Sample (client name) | Role in workflow | System mapping |
|----------------------|------------------|----------------|
| OVER ALL staff seniority WORKSHEET | Master staff by designation (FORM-01) | Teacher / HM import; seniority |
| CLUBBED HSC PRACTICAL CENTRE | School → practical centre clubbing | `centre_school_relationships` + subject scope |
| HSC-SECOND YEAR - PRACTICAL | School × subject × batch counts | Practical demand input |
| Duty-In.docx | Appointment of **external** examiner (per host school) | Practical report |
| Duty-Out.docx | External duty list (per teacher home school) | Practical report |
| HSE 2026 BOOKLET | Centre strength / abstract / SSLC centres | Centre master + hall strength |
| DCS MASTER CHECK LIST | Centre roll-up checklist PDF | Centre strength QA |
| Practical Exam Question Paper Allotment | Per-subject batch question numbers | Adjacent practical QP workflow |
| 12TH / BIO BOTANY / ZOOLOGY labels | Question-pack label slips | Adjacent labeling (not duty allotment) |

## Observed layouts (anonymized)

### Staff seniority (FORM-01) sheets

Sheets seen: `HM`, `PG`, `BT`, `BT NON`, `SGT`, `SPL`, `NON TEACHING`.

Typical columns: S.NO, SCHOOL CODE, NAME OF THE SCHOOL, TYPE (GOVT/AIDED), HEADMASTER/TEACHER NAME, SEX, MOBILE, QUALIFICATION, MAJOR SUBJECT, DATE OF APPOINTMENT (DD/MM/YYYY), DATE OF RETIREMENT, RESIDENTIAL UNION/BLOCK, PREVIOUS EXAM DUTY, PREVIOUS CAMP DUTY, PHYSICAL/MEDICAL/MATERNITY flag, BLOCK.

→ Feeds OQ-003 designation taxonomy (interim list from sheets; not official confirmation).

### Practical clubbing

Headers: `S.NO`, `SCH CODE`, `SCHOOL NAME`, `SUBJECT`, `NAME OF THE PRACTICAL CENTRE`.  
`SUBJECT` may be `ALL`, a single subject, or split across continuation rows.

### Practical batch demand

Headers: `Sl.No.`, `School No.`, `Subject`, `No. of Batch` with per-school totals.

### Duty-In (host school letter)

Title: Higher Secondary Practical Examination · District · **APPOINTMENT OF EXTERNAL EXAMINER**.  
Header: School Number, School Name, City.  
Rows: From/To dates, Subject, No. of Batches, External name + school, Internal Name.  
Footer: Chief Educational Officer / district (OQ-016 letterhead).

### Duty-Out (home school letter)

Title: **EXTERNAL EXAMINER DUTY FOR TEACHERS**.  
Rows: Subject, Teacher name, External duty school, No. of batches, From/To dates.

### Centre booklet / DCS

Centre number + name + student strength (12th / 11th arrear). Used for hall capacity and checklisting.

### Question paper allotment / labels

Per subject: School No, Batch, Register No (often blank), Question No.  
Label slips encode section codes (I.A1, II.B3, …). **Out of core duty-allotment engine** until client confirms whether this product owns QP packing (see OQ-019).

## Engineering stance

- Duty-In / Duty-Out builders match letter **layouts** (synthetic data).
- Clubbing import **applies** into in-memory `relationships` (closes prior CLUBBED for matched schools).
- Batch demand is held in app state and mapped by **school code** into Practical generate.
- Centre strength updates `centres.capacity` for Hall demand when matched by centre code.
- FORM-01 seniority import emits **synthetic** `SYN-…` employee codes only — never copy real staff IDs into git.
- Do not hard-code Tamil/English letterhead as final (OQ-016).
- Question-paper packing / labels stay out of the duty engine until OQ-019.
