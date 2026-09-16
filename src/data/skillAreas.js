// The four Skill Areas of the official AI-200 "skills measured" outline, named verbatim.
export const SKILL_AREAS = [
  { id: 'containers', name: 'Develop containerized solutions on Azure', weight: '20–25%' },
  { id: 'data', name: 'Develop AI solutions by using Azure data management services', weight: '25–30%' },
  { id: 'connect', name: 'Connect to and consume Azure services', weight: '20–25%' },
  { id: 'secure', name: 'Secure, monitor, and troubleshoot Azure solutions', weight: '20–25%' },
]

export function skillAreaById(id) {
  return SKILL_AREAS.find((a) => a.id === id)
}
