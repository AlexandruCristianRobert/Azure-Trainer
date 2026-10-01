// Fictional training passages and authored 8-dimensional vectors. These are
// browser-local teaching fixtures, not real product policies or model output.
// Visible samples are deliberately small; logicalRows drives simulated costs.
const vector = (slot, offset) => Array.from({ length: 8 }, (_, i) => (
  i === slot ? 1 : i === slot + 1 ? offset : 0
))

const groups = [
  {
    product: 'contoso-backup', version: 'v1', language: 'en',
    topics: [
      ['retention', 0, [0.2, 0.22], [
        'Contoso Backup v1 retains snapshots for 35 days by default. Set a custom retention rule on the vault policy to extend this period.',
        'The v1 vault policy applies the 35-day retention window to new snapshots. Existing snapshots keep the expiry date recorded when they were created.',
      ]],
      ['restore', 2, [0.1, 0.15], [
        'In Contoso Backup v1, choose restore-to-new-rg in Backup Center to restore a snapshot into a new resource group.',
        'Before a v1 restore, confirm the target subscription and region. The restored resource inherits the snapshot tags unless you override them.',
      ]],
    ],
  },
  {
    product: 'contoso-backup', version: 'v1', language: 'de',
    topics: [
      ['retention', 0, [0.25, 0.3], [
        'Contoso Backup v1 bewahrt Snapshots standardmaessig 35 Tage auf. Eine eigene Regel in der Tresorrichtlinie kann diese Frist verlaengern.',
        'Die Aufbewahrungsregel von v1 gilt fuer neue Snapshots. Vorhandene Snapshots behalten ihr bei der Erstellung festgelegtes Ablaufdatum.',
      ]],
      ['restore', 2, [0.2, 0.25], [
        'Waehlen Sie in Contoso Backup v1 restore-to-new-rg im Backup Center, um einen Snapshot in einer neuen Ressourcengruppe wiederherzustellen.',
        'Pruefen Sie vor der v1-Wiederherstellung das Zielabonnement und die Region. Tags werden uebernommen, sofern Sie keine anderen Tags festlegen.',
      ]],
    ],
  },
  {
    product: 'contoso-backup', version: 'v2', language: 'en',
    topics: [
      // This near-duplicate pair makes losing one neighbour visible in recall.
      ['retention', 0, [0.1, 0.101], [
        'Contoso Backup v2 retains snapshots for 45 days by default. A vault policy can extend the retention window for future snapshots.',
        'By default, Contoso Backup v2 keeps snapshots for 45 days. Extend the retention window for future snapshots through a vault policy.',
      ]],
      ['restore', 2, [0.3, 0.35], [
        'Contoso Backup v2 uses the Restore wizard. Choose New resource group, then select the destination subscription and region.',
        'The v2 Restore wizard previews destination tags before confirmation. Confirm the preview to start the new-resource-group restore.',
      ]],
    ],
  },
  {
    product: 'contoso-backup', version: 'v2', language: 'de',
    topics: [
      ['retention', 0, [0.35, 0.4], [
        'Contoso Backup v2 bewahrt Snapshots standardmaessig 45 Tage auf. Eine Tresorrichtlinie kann die Frist fuer zukuenftige Snapshots verlaengern.',
        'In v2 sehen Sie das Ablaufdatum auf der Seite Snapshotdetails. Eine Richtlinienaenderung verschiebt das Ablaufdatum vorhandener Snapshots nicht.',
      ]],
      ['restore', 2, [0.4, 0.45], [
        'Contoso Backup v2 bietet einen Wiederherstellungsassistenten. Waehlen Sie Neue Ressourcengruppe und anschliessend Zielabonnement und Region.',
        'Der v2-Assistent zeigt vor der Bestaetigung eine Vorschau der Ziel-Tags. Bestaetigen Sie die Vorschau, um die Wiederherstellung zu starten.',
      ]],
    ],
  },
  {
    product: 'contoso-support', version: 'v1', language: 'en',
    topics: [
      ['hours', 4, [0.1, 0.15], [
        'Contoso Support v1 provides 24x7 on-call coverage for Severity 1 incidents. Non-critical tickets are handled on business days from 9am to 6pm.',
        'For a v1 Severity 1 incident, open a critical ticket and give the on-call engineer the affected resource ID and business impact.',
      ]],
      ['escalation', 6, [0.1, 0.15], [
        'Contoso Support v1 routes senior-engineer requests through the Escalate panel. Raise the priority to Sev1 and request an escalation there.',
        'The v1 Escalate panel routes to a senior engineer. To reach a support manager instead, call the support hotline and quote the ticket ID.',
      ]],
    ],
  },
  {
    product: 'contoso-support', version: 'v1', language: 'de',
    topics: [
      ['hours', 4, [0.2, 0.25], [
        'Contoso Support v1 bietet fuer Severity-1-Vorfaelle einen Bereitschaftsdienst rund um die Uhr. Nicht kritische Tickets werden werktags von 9 bis 18 Uhr bearbeitet.',
        'Erstellen Sie fuer einen kritischen v1-Vorfall ein Severity-1-Ticket. Geben Sie die Ressourcen-ID und die geschaeftlichen Auswirkungen an.',
      ]],
      ['escalation', 6, [0.2, 0.25], [
        'Setzen Sie in Contoso Support v1 die Prioritaet auf Sev1. Fordern Sie danach im Bereich Escalate die Hilfe eines leitenden Engineers an.',
        'Der Bereich Escalate von v1 vermittelt einen leitenden Engineer. Einen Supportmanager erreichen Sie ueber die Hotline mit der Ticket-ID.',
      ]],
    ],
  },
  {
    product: 'contoso-support', version: 'v2', language: 'en',
    topics: [
      ['hours', 4, [0.3, 0.35], [
        'Contoso Support v2 provides 24x7 coverage for Severity 1 and Severity 2 incidents. Severity 3 tickets remain limited to business hours.',
        'Open the v2 Incident workspace to contact the on-call team. Include the resource ID, impact, and the latest diagnostic timestamp.',
      ]],
      ['escalation', 6, [0.3, 0.35], [
        'In Contoso Support v2, open the Incident workspace and select Request senior review to escalate a ticket to a senior engineer.',
        'The v2 senior-review request requires an impact summary and a diagnostic bundle. Track the request in the ticket timeline.',
      ]],
    ],
  },
  {
    product: 'contoso-support', version: 'v2', language: 'de',
    topics: [
      ['hours', 4, [0.4, 0.45], [
        'Contoso Support v2 bietet fuer Severity 1 und Severity 2 Bereitschaft rund um die Uhr. Severity-3-Tickets werden nur waehrend der Geschaeftszeiten bearbeitet.',
        'Kontaktieren Sie das Bereitschaftsteam im v2-Incident-Arbeitsbereich. Geben Sie Ressourcen-ID, Auswirkungen und den letzten Diagnosezeitpunkt an.',
      ]],
      ['escalation', 6, [0.4, 0.45], [
        'Oeffnen Sie in Contoso Support v2 den Incident-Arbeitsbereich. Waehlen Sie Request senior review, um einen leitenden Engineer anzufordern.',
        'Die v2-Anforderung benoetigt eine Zusammenfassung der Auswirkungen und ein Diagnosepaket. Der Status erscheint in der Ticket-Zeitleiste.',
      ]],
    ],
  },
]

const documents = []
const chunks = []
for (const { product, version, language, topics } of groups) {
  for (const [topic, slot, offsets, passages] of topics) {
    // Numeric IDs match the labs' bigint primary and foreign key columns.
    const id = documents.length + 1
    documents.push({
      id, product, version, language,
      metadata: { product, version, language, audience: 'operators', tags: [topic, 'training-only'] },
      body: passages.join('\n\n'),
      updated_at: version === 'v1' ? '2025-01-06T09:00:00Z' : '2025-06-02T09:00:00Z',
    })
    passages.forEach((content, chunk_index) => chunks.push({
      id: chunks.length + 1, document_id: id, chunk_index, content,
      embedding: vector(slot, offsets[chunk_index]),
    }))
  }
}

// A deliberately misleading authored embedding: without metadata filtering the
// Backup v1 retention question ranks this unrelated Support passage first.
chunks.find((chunk) => chunk.id === 17).embedding = vector(0, 0)

export const CORPUS = {
  version: 1,
  logicalRows: { documents: 20000, chunks: 250000 },
  documents,
  chunks,
}

const questions = [
  {
    text: 'How many days are Contoso Backup v1 snapshots retained by default?',
    product: 'contoso-backup', version: 'v1', language: 'en', vector: vector(0, 0),
    expectedChunkIds: [1, 2],
    answer: 'Contoso Backup v1 snapshots are retained for 35 days by default.',
  },
  {
    text: 'Wie stelle ich in Contoso Backup v1 einen Snapshot in einer neuen Ressourcengruppe wieder her?',
    product: 'contoso-backup', version: 'v1', language: 'de', vector: vector(2, 0),
    expectedChunkIds: [7, 8],
    answer: 'Waehlen Sie restore-to-new-rg im Backup Center und pruefen Sie Zielabonnement und Region.',
  },
  {
    text: 'What is the default snapshot retention window in Contoso Backup v2?',
    product: 'contoso-backup', version: 'v2', language: 'en', vector: vector(0, 0),
    expectedChunkIds: [9, 10],
    answer: 'Contoso Backup v2 retains snapshots for 45 days by default.',
  },
  {
    text: 'Wie starte ich in Contoso Backup v2 eine Wiederherstellung in einer neuen Ressourcengruppe?',
    product: 'contoso-backup', version: 'v2', language: 'de', vector: vector(2, 0),
    expectedChunkIds: [15, 16],
    answer: 'Waehlen Sie Neue Ressourcengruppe im Wiederherstellungsassistenten, pruefen Sie das Ziel und bestaetigen Sie die Tag-Vorschau.',
  },
  {
    text: 'How do I escalate a Contoso Support v1 ticket to a senior engineer?',
    product: 'contoso-support', version: 'v1', language: 'en', vector: vector(6, 0),
    expectedChunkIds: [19, 20],
    answer: 'Raise the priority to Sev1 and request an escalation in the Escalate panel.',
  },
  {
    text: 'Wann ist der Bereitschaftsdienst von Contoso Support v2 fuer Severity 1 und Severity 2 erreichbar?',
    product: 'contoso-support', version: 'v2', language: 'de', vector: vector(4, 0),
    expectedChunkIds: [29, 30],
    answer: 'Contoso Support v2 bietet fuer Severity 1 und Severity 2 Bereitschaft rund um die Uhr.',
  },
]

// Return independent rows so a simulated database can edit them without changing
// the canonical sample or another lab run (including nested JSON and vectors).
export function corpusRows() {
  return {
    documents: CORPUS.documents.map((document) => ({
      ...document, metadata: { ...document.metadata, tags: [...document.metadata.tags] },
    })),
    chunks: CORPUS.chunks.map((chunk) => ({ ...chunk, embedding: [...chunk.embedding] })),
  }
}

export function corpusQuestions() {
  return questions.map((question) => ({
    ...question, vector: [...question.vector], expectedChunkIds: [...question.expectedChunkIds],
  }))
}
