import { runSeedCredits } from './fanart-credits'

process.exitCode = runSeedCredits(process.argv.slice(2), (l) => console.log(l))
