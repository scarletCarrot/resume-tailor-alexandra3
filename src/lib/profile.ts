import type { CandidateProfile } from "./types";

export const CANDIDATE_PROFILE: CandidateProfile = {
  personal: {
    name: "Alexandra Croitoru",
    phone: "+40 373 806 070",
    linkedin: "https://www.linkedin.com/in/alexandra-croitoru-304a0a419/",
    email: "alexandracroitoru1991@gmail.com",
    location: "Bucharest, Romania",
  },
  experiences: [
    {
      company: "NVIDIA",
      title: "Senior Software Engineer",
      period: "Apr 2026 - July 2026",
      location: "Remote",
    },
    {
      company: "Provision",
      title: "Senior Software Engineer",
      period: "Jun 2022 – Feb 2026",
      location: "Remote",
    },
    {
      company: "Accenture Romania",
      title: "Software Engineer",
      period: "Jan 2018 – Feb 2022",
      location: "Remote",
    },
    {
      company: "WITSIDE",
      title: "Software Developer",
      period: "Apr 2015 – Dec 2016",
      location: "Greece",
    },
  ],
  education: [
    {
      school: "University of Crete",
      degree: "Bachelor of Degree in Computer Science",
      period: "2010 – 2014",
      location: "Greece",
    },
  ],
};

export const CANDIDATE_HEADLINE = "Senior Software Engineer";
