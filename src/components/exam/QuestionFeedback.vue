<script setup>
import { computed } from 'vue'
import { validateQuestion } from '../../lib/exam/question.js'
import { EXAM_LIMITS, arrayOf, finiteJson, member, record, requireExam, uniqueRecords, validateReference } from '../../lib/exam/contracts.js'
import '../../styles/exam.css'

// The caller sets permitted only after the store acknowledges disclosure.
// This component consumes an explicit Grade; it never grades or tracks exposure.
const props = defineProps({ question: { default: null }, grade: { default: null }, references: { default: () => [] }, permitted: Boolean })
const feedback = computed(() => {
  if (props.permitted !== true) return null
  try {
    validateQuestion(props.question, { historical: true })
    const grade = props.grade, q = props.question
    finiteJson(grade, EXAM_LIMITS.questionBytes)
    record(grade, ['questionId', 'outcomes', 'earned', 'possible'])
    requireExam(grade.questionId === q.id, 'Grade question mismatch')
    arrayOf(grade.outcomes, EXAM_LIMITS.components, (outcome, index) => {
      record(outcome, ['componentId', 'conceptId', 'earned', 'possible', 'status', 'attempted'])
      const component = q.components[index]
      requireExam(component && outcome.componentId === component.id && outcome.conceptId === component.conceptId, 'Outcome component mismatch')
      member(outcome.earned, [0, 1]); member(outcome.possible, [1])
      member(outcome.status, ['correct', 'wrong', 'unanswered', 'incomplete'])
      requireExam(outcome.earned === (outcome.status === 'correct' ? 1 : 0) && outcome.attempted === ['correct', 'wrong'].includes(outcome.status), 'Inconsistent outcome')
    })
    requireExam(grade.outcomes.length === q.components.length && grade.possible === q.components.length && grade.earned === grade.outcomes.reduce((sum, outcome) => sum + outcome.earned, 0), 'Inconsistent grade totals')
    finiteJson(props.references)
    arrayOf(props.references, EXAM_LIMITS.items * EXAM_LIMITS.candidates, validateReference)
    uniqueRecords(props.references)
    const sources = q.referenceIds.map((id) => props.references.find((reference) => reference.id === id))
    requireExam(sources.every(Boolean), 'Missing approved reference')
    return { sources }
  } catch { return false }
})
function label(componentId) {
  const p = props.question.presentation
  const bindings = p.slots ?? p.targets ?? p.rows ?? p.fields ?? p.segments?.filter((segment) => segment.type === 'slot') ?? []
  return bindings.find((binding) => binding.componentId === componentId)?.label ?? 'Answer'
}
function candidateLabel(id) {
  const p = props.question.presentation
  return (p.choices ?? p.candidates ?? p.regions).find((candidate) => candidate.id === id).label
}
function expected(component) { return (Array.isArray(component.expected) ? component.expected : [component.expected]).map(candidateLabel).join(', ') }
</script>

<template>
  <section v-if="feedback" class="exam-feedback" aria-label="Question feedback">
    <h3>Feedback</h3>
    <p class="exam-score">{{ grade.earned }} / {{ grade.possible }} points</p>
    <ul class="exam-outcomes">
      <li v-for="(component, index) in question.components" :key="component.id">
        <strong>{{ label(component.id) }}:</strong> {{ grade.outcomes[index].status }}
        <p>Correct answer: {{ expected(component) }}</p>
      </li>
    </ul>
    <details class="exam-rationale">
      <summary>Explanation and answer reasons</summary>
      <p v-if="typeof question.explanation === 'string'" class="exam-plain-text" data-component-reason>{{ question.explanation }}</p>
      <section v-for="entry in typeof question.explanation === 'string' ? [] : question.explanation.components" :key="entry.componentId">
        <h4>{{ label(entry.componentId) }}</h4>
        <p class="exam-plain-text" data-component-reason>{{ entry.text }}</p>
        <ul>
          <li v-for="reason in entry.candidates" :key="reason.candidateId" class="exam-plain-text" data-candidate-reason><strong>{{ candidateLabel(reason.candidateId) }}:</strong> {{ reason.text }}</li>
        </ul>
      </section>
    </details>
    <details class="exam-sources">
      <summary>Reviewed sources</summary>
      <ul><li v-for="source in feedback.sources" :key="source.id"><a :href="source.url">{{ source.title }}</a><span class="exam-hint"> (reviewed {{ source.reviewedAt }})</span></li></ul>
    </details>
    <details v-if="question.csharp !== null" class="exam-artifact">
      <summary>C# example</summary>
      <pre><code>{{ question.csharp }}</code></pre>
    </details>
  </section>
  <p v-else-if="permitted === true" class="exam-error" role="alert">Feedback cannot be displayed. Return to the question list and try again.</p>
</template>
