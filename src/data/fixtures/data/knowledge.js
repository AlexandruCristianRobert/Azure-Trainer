// Fictional, training-only fixtures for the Data learning journey's Knowledge Assistant.
// No real Azure, model or database is called; every vector below is an authored
// teaching approximation (see CONTEXT.md: "Simulated estimate — not an Azure guarantee.").

// Canonical-question vectors live in a dedicated 2-dimension slot of the 8-dim
// space so that unrelated questions are exactly orthogonal (cosine 0). A
// paraphrase is the same slot rotated 15° (cosine ≈ 0.9659, clears the >= 0.95
// bar); a near miss is the same slot rotated 30° (cosine ≈ 0.8660, inside the
// 0.80–0.88 band) but keeps a different answer from its canonical question.
const COS_15 = 0.9659
const SIN_15 = 0.2588
const COS_30 = 0.866
const SIN_30 = 0.5

// embeddings-v2 is derived deterministically by appending 4 zeros to the
// 8-dim embeddings-v1 vector (cosine is preserved by zero padding).
const toV2 = (vector) => vector.concat([0, 0, 0, 0])

export const DATA_FIXTURES = Object.freeze({
  version: 1,
  products: Object.freeze(['contoso-backup', 'contoso-support']),
  embeddings: Object.freeze({
    'embeddings-v1': Object.freeze({ dimensions: 8 }),
    'embeddings-v2': Object.freeze({ dimensions: 12 }),
  }),
  questions: Object.freeze({
    'How many days are Contoso Backup snapshots retained?': Object.freeze({
      id: 'backup-retention',
      product: 'contoso-backup',
      vector: Object.freeze([1, 0, 0, 0, 0, 0, 0, 0]),
      vectorV2: Object.freeze(toV2([1, 0, 0, 0, 0, 0, 0, 0])),
      answer: 'Contoso Backup snapshots are retained for 35 days by default.',
      sourceIds: Object.freeze(['kb-backup-retention-1', 'kb-backup-retention-2']),
    }),
    'How do I restore a Contoso Backup snapshot to a new resource group?': Object.freeze({
      id: 'backup-restore',
      product: 'contoso-backup',
      vector: Object.freeze([0, 0, 1, 0, 0, 0, 0, 0]),
      vectorV2: Object.freeze(toV2([0, 0, 1, 0, 0, 0, 0, 0])),
      answer:
        "Restore a Contoso Backup snapshot to a new resource group using the restore-to-new-rg option in the Backup Center, then confirm the target subscription and region.",
      sourceIds: Object.freeze(['kb-backup-restore-1', 'kb-backup-restore-2']),
    }),
    "What are Contoso Support's on-call hours for critical incidents?": Object.freeze({
      id: 'support-hours',
      product: 'contoso-support',
      vector: Object.freeze([0, 0, 0, 0, 1, 0, 0, 0]),
      vectorV2: Object.freeze(toV2([0, 0, 0, 0, 1, 0, 0, 0])),
      answer: 'Contoso Support provides 24x7 on-call coverage for Severity 1 incidents.',
      sourceIds: Object.freeze(['kb-support-hours-1']),
    }),
    'How do I escalate a Contoso Support ticket to a senior engineer?': Object.freeze({
      id: 'support-escalation',
      product: 'contoso-support',
      vector: Object.freeze([0, 0, 0, 0, 0, 0, 1, 0]),
      vectorV2: Object.freeze(toV2([0, 0, 0, 0, 0, 0, 1, 0])),
      answer:
        "Escalate a Contoso Support ticket to a senior engineer by raising the ticket priority to Sev1 and requesting an escalation in the portal's Escalate panel.",
      sourceIds: Object.freeze(['kb-support-escalation-1', 'kb-support-escalation-2']),
    }),
  }),
  paraphrases: Object.freeze({
    'How long does Contoso Backup keep my snapshots?': Object.freeze({
      of: 'How many days are Contoso Backup snapshots retained?',
      vector: Object.freeze([COS_15, SIN_15, 0, 0, 0, 0, 0, 0]),
    }),
    "What's the process to restore a Contoso Backup snapshot into a different resource group?": Object.freeze({
      of: 'How do I restore a Contoso Backup snapshot to a new resource group?',
      vector: Object.freeze([0, 0, COS_15, SIN_15, 0, 0, 0, 0]),
    }),
    'What on-call hours does Contoso Support offer for Sev1 issues?': Object.freeze({
      of: "What are Contoso Support's on-call hours for critical incidents?",
      vector: Object.freeze([0, 0, 0, 0, COS_15, SIN_15, 0, 0]),
    }),
    "What's the process for escalating a Contoso Support ticket to a senior engineer?": Object.freeze({
      of: 'How do I escalate a Contoso Support ticket to a senior engineer?',
      vector: Object.freeze([0, 0, 0, 0, 0, 0, COS_15, SIN_15]),
    }),
  }),
  nearMisses: Object.freeze({
    'How do I permanently delete a Contoso Backup snapshot before its retention period ends?': Object.freeze({
      near: 'How many days are Contoso Backup snapshots retained?',
      vector: Object.freeze([COS_30, SIN_30, 0, 0, 0, 0, 0, 0]),
      answer:
        "Contact Contoso Backup support to request an early deletion; self-service early deletion isn't available.",
    }),
    'How do I restore a Contoso Backup snapshot to the same resource group it came from?': Object.freeze({
      near: 'How do I restore a Contoso Backup snapshot to a new resource group?',
      vector: Object.freeze([0, 0, COS_30, SIN_30, 0, 0, 0, 0]),
      answer: 'Use the in-place restore option in Backup Center; no new resource group is created.',
    }),
    "What are Contoso Support's response hours for non-critical (Sev3) tickets?": Object.freeze({
      near: "What are Contoso Support's on-call hours for critical incidents?",
      vector: Object.freeze([0, 0, 0, 0, COS_30, SIN_30, 0, 0]),
      answer: 'Sev3 tickets are handled during business hours, 9am-6pm on business days.',
    }),
    'How do I escalate a Contoso Support ticket directly to a support manager?': Object.freeze({
      near: 'How do I escalate a Contoso Support ticket to a senior engineer?',
      vector: Object.freeze([0, 0, 0, 0, 0, 0, COS_30, SIN_30]),
      answer:
        "Manager escalation requires calling the support hotline; the portal's Escalate panel routes only to senior engineers.",
    }),
  }),
  sessions: Object.freeze([
    Object.freeze({
      id: 'msg-1',
      sessionId: 'session-1',
      userId: 'user-morgan',
      type: 'message',
      role: 'user',
      text: 'How many days are Contoso Backup snapshots retained?',
      createdAt: '2025-01-06T09:00:00Z',
    }),
    Object.freeze({
      id: 'msg-2',
      sessionId: 'session-1',
      userId: 'user-morgan',
      type: 'message',
      role: 'assistant',
      text: 'Contoso Backup snapshots are retained for 35 days by default.',
      createdAt: '2025-01-06T09:00:30Z',
    }),
    Object.freeze({
      id: 'msg-3',
      sessionId: 'session-1',
      userId: 'user-morgan',
      type: 'message',
      role: 'user',
      text: 'Can I extend that retention for a specific vault?',
      createdAt: '2025-01-06T09:01:15Z',
    }),
    Object.freeze({
      id: 'msg-4',
      sessionId: 'session-1',
      userId: 'user-morgan',
      type: 'message',
      role: 'assistant',
      text: "Yes, configure a custom retention rule on the vault's backup policy.",
      createdAt: '2025-01-06T09:01:45Z',
    }),
    Object.freeze({
      id: 'msg-5',
      sessionId: 'session-2',
      userId: 'user-morgan',
      type: 'message',
      role: 'user',
      text: 'How do I restore a Contoso Backup snapshot to a new resource group?',
      createdAt: '2025-01-06T14:00:00Z',
    }),
    Object.freeze({
      id: 'msg-6',
      sessionId: 'session-2',
      userId: 'user-morgan',
      type: 'message',
      role: 'assistant',
      text:
        "Restore a Contoso Backup snapshot to a new resource group using the restore-to-new-rg option in the Backup Center, then confirm the target subscription and region.",
      createdAt: '2025-01-06T14:00:40Z',
    }),
    Object.freeze({
      id: 'msg-7',
      sessionId: 'session-2',
      userId: 'user-morgan',
      type: 'message',
      role: 'user',
      text: 'Does the restore keep the original tags?',
      createdAt: '2025-01-06T14:01:10Z',
    }),
    Object.freeze({
      id: 'msg-8',
      sessionId: 'session-2',
      userId: 'user-morgan',
      type: 'message',
      role: 'assistant',
      text: 'Yes, tags are copied to the restored resource unless you override them.',
      createdAt: '2025-01-06T14:01:50Z',
    }),
    Object.freeze({
      id: 'msg-9',
      sessionId: 'session-3',
      userId: 'user-priya',
      type: 'message',
      role: 'user',
      text: "What are Contoso Support's on-call hours for critical incidents?",
      createdAt: '2025-01-07T10:00:00Z',
    }),
    Object.freeze({
      id: 'msg-10',
      sessionId: 'session-3',
      userId: 'user-priya',
      type: 'message',
      role: 'assistant',
      text: 'Contoso Support provides 24x7 on-call coverage for Severity 1 incidents.',
      createdAt: '2025-01-07T10:00:35Z',
    }),
    Object.freeze({
      id: 'msg-11',
      sessionId: 'session-3',
      userId: 'user-priya',
      type: 'message',
      role: 'user',
      text: 'How do I escalate a Contoso Support ticket to a senior engineer?',
      createdAt: '2025-01-07T10:01:05Z',
    }),
    Object.freeze({
      id: 'msg-12',
      sessionId: 'session-3',
      userId: 'user-priya',
      type: 'message',
      role: 'assistant',
      text:
        "Escalate a Contoso Support ticket to a senior engineer by raising the ticket priority to Sev1 and requesting an escalation in the portal's Escalate panel.",
      createdAt: '2025-01-07T10:01:40Z',
    }),
  ]),
  qaHistory: Object.freeze([
    Object.freeze({
      id: 'qa-1',
      product: 'contoso-backup',
      question: 'How many days are Contoso Backup snapshots retained?',
      answer: 'Contoso Backup snapshots are retained for 35 days by default.',
      embedding: Object.freeze([1, 0, 0, 0, 0, 0, 0, 0]),
      createdAt: '2025-01-03T08:30:00Z',
    }),
    Object.freeze({
      id: 'qa-2',
      product: 'contoso-backup',
      question: 'How do I restore a Contoso Backup snapshot to a new resource group?',
      answer:
        "Restore a Contoso Backup snapshot to a new resource group using the restore-to-new-rg option in the Backup Center, then confirm the target subscription and region.",
      embedding: Object.freeze([0, 0, 1, 0, 0, 0, 0, 0]),
      createdAt: '2025-01-04T11:15:00Z',
    }),
    Object.freeze({
      id: 'qa-3',
      product: 'contoso-backup',
      question: 'How do I check the status of a Contoso Backup job?',
      answer: "Check job status on the Backup Center's Jobs tab; failed jobs show a retry option.",
      embedding: Object.freeze([0.5, 0.2, 0.5, 0.2, 0, 0, 0, 0]),
      createdAt: '2025-01-05T16:45:00Z',
    }),
    Object.freeze({
      id: 'qa-4',
      product: 'contoso-support',
      question: "What are Contoso Support's on-call hours for critical incidents?",
      answer: 'Contoso Support provides 24x7 on-call coverage for Severity 1 incidents.',
      embedding: Object.freeze([0, 0, 0, 0, 1, 0, 0, 0]),
      createdAt: '2025-01-03T09:00:00Z',
    }),
    Object.freeze({
      id: 'qa-5',
      product: 'contoso-support',
      question: 'How do I escalate a Contoso Support ticket to a senior engineer?',
      answer:
        "Escalate a Contoso Support ticket to a senior engineer by raising the ticket priority to Sev1 and requesting an escalation in the portal's Escalate panel.",
      embedding: Object.freeze([0, 0, 0, 0, 0, 0, 1, 0]),
      createdAt: '2025-01-04T13:20:00Z',
    }),
    Object.freeze({
      id: 'qa-6',
      product: 'contoso-support',
      question: 'What information do I need before opening a Contoso Support ticket?',
      answer:
        'Include the affected resource ID, the environment, and a description of the impact before opening a ticket.',
      embedding: Object.freeze([0, 0, 0, 0, 0.5, 0.2, 0.5, 0.2]),
      createdAt: '2025-01-05T15:10:00Z',
    }),
  ]),
})

// Looks a question up across questions, paraphrases and near misses, and returns
// the vector for the requested deployment. Unknown text returns null.
export function embed(text, deployment = 'embeddings-v1') {
  const entry = DATA_FIXTURES.questions[text] || DATA_FIXTURES.paraphrases[text] || DATA_FIXTURES.nearMisses[text]
  if (!entry) return null
  if (deployment === 'embeddings-v2') {
    return entry.vectorV2 ? entry.vectorV2.slice() : toV2(entry.vector)
  }
  return entry.vector.slice()
}

// Cosine similarity between two vectors. Vectors of different lengths are
// compared over their union, treating missing entries as 0. Returns 0 when
// either vector has zero magnitude (rather than dividing by zero).
export function cosine(a = [], b = []) {
  const length = Math.max(a.length, b.length)
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < length; i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    magA += x * x
    magB += y * y
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}
