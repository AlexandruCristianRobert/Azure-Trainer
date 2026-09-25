const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

const trainingAnswer = 'Training backups are kept for 30 days.'
const trainingSupportAnswer = 'Contact the training desk for support.'
const reviewAnswer = 'Review backups are kept for 7 days.'
const partnerSupportAnswer = 'Contact the partner desk for support.'
const internalReviewAnswer = 'Internal review policy: keep backups for 60 days.'
const trainingDraftAnswer = 'Draft training policy: keep backups for 90 days.'
const partnerDraftAnswer = 'Draft partner policy: keep backups for 21 days.'

const question = (embedding, answers) => ({ embedding, answers })
const document = (id, content, collection, audience, published, embedding, answer) =>
  ({ id, content, collection, audience, published, embedding, answer })
const stage = (latencyMs, result = 'success', code = undefined, retryAfterMs = undefined) =>
  ({ latencyMs, ...(code ? { code } : { result }), ...(retryAfterMs === undefined ? {} : { retryAfterMs }) })
const healthyStages = () => ({ embedding: [stage(40)], postgres: [stage(30)], answer: [stage(50)] })

export const INTEGRATION_FIXTURES = freeze({
  version: 1,
  profiles: {
    training: {
      AI_ENDPOINT: 'https://ai-training.example', ANSWER_DEPLOYMENT: 'answers-v1', EMBEDDING_DEPLOYMENT: 'embeddings-v1',
      PGHOST: 'pg-training.example', PGDATABASE: 'knowledge', PGUSER: 'assistant_training', PGPASSWORD: 'training-only-password',
      COLLECTION: 'training', AUDIENCE: 'employee',
    },
    review: {
      AI_ENDPOINT: 'https://ai-review.example', ANSWER_DEPLOYMENT: 'answers-v1', EMBEDDING_DEPLOYMENT: 'embeddings-v1',
      PGHOST: 'pg-review.example', PGDATABASE: 'knowledge', PGUSER: 'assistant_review', PGPASSWORD: 'review-only-password',
      COLLECTION: 'review', AUDIENCE: 'partner',
    },
  },
  scenarioProfiles: {
    healthy: { stages: healthyStages() },
    'embedding-throttle-once': { stages: { embedding: [stage(40, undefined, 'THROTTLED', 150), stage(40)], postgres: [stage(30)], answer: [stage(50)] } },
    'postgres-unavailable-once': { stages: { embedding: [stage(40)], postgres: [stage(30, undefined, 'UNAVAILABLE'), stage(30)], answer: [stage(50)] } },
    'answer-unavailable-always': { stages: { embedding: [stage(40)], postgres: [stage(30)], answer: [stage(50, undefined, 'UNAVAILABLE'), stage(50, undefined, 'UNAVAILABLE'), stage(50, undefined, 'UNAVAILABLE')] } },
    'embedding-timeout-always': { stages: { embedding: [stage(500, undefined), stage(500, undefined), stage(500, undefined)], postgres: [stage(30)], answer: [stage(50)] } },
    'retry-after-too-long': { stages: { embedding: [stage(40, undefined, 'THROTTLED', 1500), stage(40)], postgres: [stage(30)], answer: [stage(50)] } },
  },
  questions: {
    'How long are backups kept?': question([1, 0, 0], { 'training-backups': trainingAnswer, 'review-backups': reviewAnswer, '00-training-draft': trainingDraftAnswer, '00-review-employee': internalReviewAnswer, '00-review-draft': partnerDraftAnswer }),
    'Who provides support?': question([0, 1, 0], { 'training-support': trainingSupportAnswer, 'review-support': partnerSupportAnswer }),
    "Who's on support?": question([0, 1, 0], { 'training-support': trainingSupportAnswer, 'review-support': partnerSupportAnswer }),
    'What is the travel allowance?': question([0, 0, 1], {}),
  },
  documents: {
    'training-backups': document('training-backups', 'Training backups are kept for 30 days.', 'training', 'employee', true, [1, 0, 0], trainingAnswer),
    'training-support': document('training-support', 'Contact the training desk for support.', 'training', 'employee', true, [0, 1, 0], trainingSupportAnswer),
    'review-backups': document('review-backups', 'Review backups are kept for 7 days.', 'review', 'partner', true, [1, 0, 0], reviewAnswer),
    'review-support': document('review-support', 'Contact the partner desk for support.', 'review', 'partner', true, [0, 1, 0], partnerSupportAnswer),
    '00-training-draft': document('00-training-draft', 'Draft training policy: keep backups for 90 days.', 'training', 'employee', false, [1, 0, 0], trainingDraftAnswer),
    '00-review-employee': document('00-review-employee', 'Internal review policy: keep backups for 60 days.', 'review', 'employee', true, [1, 0, 0], internalReviewAnswer),
    '00-review-draft': document('00-review-draft', 'Draft partner policy: keep backups for 21 days.', 'review', 'partner', false, [1, 0, 0], partnerDraftAnswer),
  },
})
