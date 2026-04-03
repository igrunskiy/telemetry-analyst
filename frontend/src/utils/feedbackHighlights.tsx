import React from 'react'
import type { ReportFeedback } from '../types'

export type FeedbackGroup = { key: string; items: ReportFeedback[] }

type Match = {
  start: number
  end: number
  group: FeedbackGroup
}

function normalizeForMatch(text: string): { normalized: string; map: number[] } {
  const chars: string[] = []
  const map: number[] = []
  let previousWasSpace = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const normalizedChar = /[a-z0-9]/i.test(char) ? char.toLowerCase() : ' '
    if (normalizedChar === ' ') {
      if (!previousWasSpace) {
        chars.push(' ')
        map.push(index)
        previousWasSpace = true
      }
      continue
    }
    chars.push(normalizedChar)
    map.push(index)
    previousWasSpace = false
  }

  return {
    normalized: chars.join('').trim(),
    map,
  }
}

function candidateNeedles(text: string): string[] {
  const source = text.trim()
  if (!source) return []

  const pieces = [
    source,
    ...source.split(/[\n\r]+|(?<=[.!?])\s+|[;:]+/g),
    ...source.split(/,\s+/g),
  ]

  const unique = new Set<string>()
  for (const piece of pieces) {
    const normalized = normalizeForMatch(piece).normalized.trim()
    if (normalized.length >= 8) unique.add(normalized)
  }

  return [...unique].sort((a, b) => b.length - a.length)
}

export function normalizeFeedbackSelections(feedbackItems?: ReportFeedback[] | null): FeedbackGroup[] {
  const grouped = new Map<string, ReportFeedback[]>()
  for (const item of feedbackItems ?? []) {
    const text = item.selected_text?.trim()
    if (text && text.length >= 8) {
      grouped.set(text, [...(grouped.get(text) ?? []), item])
    }
  }
  return [...grouped.entries()]
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => b.key.length - a.key.length)
}

export function renderHighlightedText(
  text: string,
  highlights: FeedbackGroup[],
  onClick?: (group: FeedbackGroup, target: HTMLElement) => void,
): React.ReactNode {
  if (!text || highlights.length === 0) return text

  const matches: Match[] = []
  const { normalized: normalizedText, map: normalizedToOriginal } = normalizeForMatch(text)
  if (!normalizedText) return text

  for (const highlight of highlights) {
    const needles = candidateNeedles(highlight.key)
    let bestMatch: Match | null = null

    for (const needle of needles) {
      const index = normalizedText.indexOf(needle)
      if (index === -1) continue
      const normalizedEnd = index + needle.length - 1
      const start = normalizedToOriginal[index]
      const end = (normalizedToOriginal[normalizedEnd] ?? (text.length - 1)) + 1
      if (start == null || end <= start) continue
      bestMatch = { start, end, group: highlight }
      break
    }

    if (!bestMatch) continue
    const overlaps = matches.some((match) => bestMatch!.start < match.end && bestMatch!.end > match.start)
    if (!overlaps) matches.push(bestMatch)
  }

  if (matches.length === 0) return text

  matches.sort((a, b) => a.start - b.start)
  const nodes: React.ReactNode[] = []
  let cursor = 0

  matches.forEach((match, idx) => {
    if (match.start > cursor) {
      nodes.push(text.slice(cursor, match.start))
    }
    nodes.push(
      <button
        key={`${match.start}-${match.end}-${idx}`}
        type="button"
        onClick={(event) => onClick?.(match.group, event.currentTarget)}
        title={`${match.group.items.length} feedback item${match.group.items.length === 1 ? '' : 's'}`}
        className="rounded-md border border-fuchsia-300/70 bg-fuchsia-300/35 px-1 py-0.5 text-inherit shadow-[0_0_0_1px_rgba(244,114,182,0.18)] underline decoration-fuchsia-200/80 decoration-2 underline-offset-2 transition-colors hover:bg-fuchsia-300/50"
      >
        {text.slice(match.start, match.end)}
      </button>,
    )
    cursor = match.end
  })

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return nodes
}
