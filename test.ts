import { taurusFiles } from './benchmarks/files/taurus.js'

taurusFiles.map((file) => {
  fetch(`http://localhost:8090/files/${file}?api_key=random-secret`)
})
