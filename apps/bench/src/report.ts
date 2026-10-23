import type { GameResult } from "./agent.ts"

const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

export const summarize = (results: GameResult[]) => {
  const byModel = Map.groupBy(results, (r) => r.model)
  return [...byModel].map(([model, rs]) => ({
    model,
    games: rs.length,
    wins: rs.filter((r) => r.end === "won").length,
    aborted: rs.filter((r) => r.end === "aborted" || r.end === "budget").length,
    avgAnte: mean(rs.map((r) => r.ante)),
    avgRound: mean(rs.map((r) => r.round)),
    bestRound: Math.max(...rs.map((r) => r.round)),
    avgTurns: mean(rs.map((r) => r.turns)),
    avgCalls: mean(rs.map((r) => r.calls)),
    avgMinutes: mean(rs.map((r) => r.ms / 60000)),
    avgInputTokens: mean(rs.map((r) => r.inputTokens)),
    avgOutputTokens: mean(rs.map((r) => r.outputTokens)),
  }))
}

export const printReport = (results: GameResult[]) => {
  const rows = summarize(results).sort((a, b) => b.wins - a.wins || b.avgRound - a.avgRound)
  console.table(
    rows.map((r) => ({
      model: r.model,
      games: r.games,
      wins: r.wins,
      aborted: r.aborted,
      "avg ante": r.avgAnte.toFixed(2),
      "avg round": r.avgRound.toFixed(1),
      "best round": r.bestRound,
      "avg turns": r.avgTurns.toFixed(0),
      "avg min": r.avgMinutes.toFixed(1),
      "avg in tok": Math.round(r.avgInputTokens),
      "avg out tok": Math.round(r.avgOutputTokens),
    })),
  )
}
