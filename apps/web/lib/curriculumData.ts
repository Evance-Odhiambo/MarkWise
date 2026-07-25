export const mockPrograms = [
  {
    id: "bsc-biochemistry",
    name: "BSc. Biochemistry",
    durationYears: 4,
    years: [
      {
        id: "biochem-y1",
        name: "Year 1",
        semesters: [
          {
            id: "biochem-y1s1",
            label: "Semester 1.1",
            units: [
              { id: "bc-u1", title: "General Chemistry", code: "BCH 1101" },
              { id: "bc-u2", title: "Introductory Biochemistry", code: "BCH 1102" },
            ],
          },
          {
            id: "biochem-y1s2",
            label: "Semester 1.2",
            units: [
              { id: "bc-u3", title: "Organic Chemistry", code: "BCH 1201" },
              { id: "bc-u4", title: "Cell Structure and Function", code: "BCH 1202" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "bsc-microbiology",
    name: "BSc. Microbiology",
    durationYears: 4,
    years: [
      {
        id: "microbio-y1",
        name: "Year 1",
        semesters: [
          {
            id: "microbio-y1s1",
            label: "Semester 1.1",
            units: [
              { id: "mb-u1", title: "Introductory Microbiology", code: "MB 1101" },
              { id: "mb-u2", title: "Microbial Genetics", code: "MB 1102" },
            ],
          },
          {
            id: "microbio-y1s2",
            label: "Semester 1.2",
            units: [
              { id: "mb-u3", title: "Environmental Microbiology", code: "MB 1201" },
              { id: "mb-u4", title: "Medical Microbiology", code: "MB 1202" },
            ],
          },
        ],
      },
    ],
  },
];
