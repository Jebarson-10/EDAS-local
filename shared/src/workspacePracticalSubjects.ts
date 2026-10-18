/** Subject spelling/reference data, not permission to appoint a different staff post. */
export const WORKSPACE_PRACTICAL_SUBJECTS = {
  "10": ["Science"],
  "12": [
    "Physics", "Chemistry", "Biology", "Botany", "Zoology", "Statistics",
    "Computer Science", "Geography", "Micro Biology", "Bio Chemistry",
    "Nursing (General)", "Nutrition and Dietetics", "Communicative English",
    "Home Science", "Computer Applications", "Basic Mechanical Engineering",
    "Basic Electrical Engineering", "Basic Electronics Engineering", "Basic Civil Engineering",
    "Basic Automobile Engineering", "Textile Technology", "Nursing (Vocational)",
    "Textiles and Dress Designing", "Food Service Management", "Agricultural Science",
    "Typography and Computer Applications", "Auditing", "Employability Skills",
  ],
} as const;

export const WORKSPACE_PRACTICAL_SOURCES = [
  { title: "DGE SSLC examination scheme", url: "https://www.dge.tn.gov.in/docs/examina/SSLC_E.pdf" },
  { title: "DGE higher-secondary examination scheme and subject groups", url: "https://www.dge.tn.gov.in/docs/examina/HSE_E.pdf" },
  { title: "DGE circular 000773, 3 February 2026: practical subjects appendix (mirrored copy)", url: "https://www.scribd.com/document/997176348/2-1-Arrear-Practical-Instructions-March-2026" },
] as const;
