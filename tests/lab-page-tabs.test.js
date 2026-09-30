import { expect, it } from 'vitest'
import { toolDestination } from '../src/lib/toolNavigation.js'

it('moves across four Bicep tabs with arrow, Home, and End keys', () => {
  const tools = ['resources', 'files', 'deployments', 'experiments']
  expect(toolDestination(tools, 1, 'ArrowRight')).toEqual({ index: 2, name: 'deployments' })
  expect(toolDestination(tools, 2, 'ArrowRight')).toEqual({ index: 3, name: 'experiments' })
  expect(toolDestination(tools, 3, 'ArrowRight')).toEqual({ index: 0, name: 'resources' })
  expect(toolDestination(tools, 0, 'ArrowLeft')).toEqual({ index: 3, name: 'experiments' })
  expect(toolDestination(tools, 2, 'Home')).toEqual({ index: 0, name: 'resources' })
  expect(toolDestination(tools, 1, 'End')).toEqual({ index: 3, name: 'experiments' })
})

it('preserves the three-tab navigation of earlier behavioral labs', () => {
  const tools = ['resources', 'files', 'experiments']
  expect(toolDestination(tools, 1, 'ArrowRight')).toEqual({ index: 2, name: 'experiments' })
  expect(toolDestination(tools, 1, 'Tab')).toBeNull()
})
