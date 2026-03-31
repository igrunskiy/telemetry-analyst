import Plotly from 'plotly.js/lib/core'
import Plot from 'react-plotly.js/factory'
import bar from 'plotly.js/lib/bar'
import heatmap from 'plotly.js/lib/heatmap'
import scatter from 'plotly.js/lib/scatter'

Plotly.register([scatter, bar, heatmap])

export default Plot(Plotly)
