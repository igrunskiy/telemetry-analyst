// Augment react-plotly.js types if needed
declare module 'react-plotly.js' {
  import * as Plotly from 'plotly.js'
  import * as React from 'react'

  export interface PlotParams {
    data: Plotly.Data[]
    layout?: Partial<Plotly.Layout>
    config?: Partial<Plotly.Config>
    frames?: Plotly.Frame[]
    style?: React.CSSProperties
    className?: string
    useResizeHandler?: boolean
    onInitialized?: (figure: Readonly<Plotly.Figure>, graphDiv: Readonly<HTMLElement>) => void
    onUpdate?: (figure: Readonly<Plotly.Figure>, graphDiv: Readonly<HTMLElement>) => void
    onPurge?: (figure: Readonly<Plotly.Figure>, graphDiv: Readonly<HTMLElement>) => void
    onError?: (err: Readonly<Error>) => void
    onClick?: (event: Readonly<Plotly.PlotMouseEvent>) => void
    onHover?: (event: Readonly<Plotly.PlotMouseEvent>) => void
    onUnhover?: (event: Readonly<Plotly.PlotMouseEvent>) => void
    onSelected?: (event: Readonly<Plotly.PlotSelectionEvent>) => void
    onRelayout?: (event: Readonly<Plotly.PlotRelayoutEvent>) => void
    divId?: string
    revision?: number
    debug?: boolean
  }

  const Plot: React.FC<PlotParams>
  export default Plot
}
