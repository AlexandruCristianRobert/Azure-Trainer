export const taskExamNote = task => task.examNote
  || [task.rationale?.what, task.rationale?.why, task.rationale?.csharp].filter(Boolean).join(' ')
  || task.text
