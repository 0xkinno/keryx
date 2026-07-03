// scripts/settle-one.js — settle one real citation through KeryxSplits
import 'dotenv/config';
import { settleCitationOnchain } from '../src/settle/citation.js';

const workId = process.argv[2] || 'k1';           // which work to cite
const answerId = 'ans_demo_' + Date.now();
const contributionPct = Number(process.argv[3] || 40);

const r = await settleCitationOnchain({ workId, answerId, contributionPct });
console.log('\n\u2713 citation settled through KeryxSplits');
console.log('  work        :', workId);
console.log('  amount       :', r.amount.toString(), 'base units');
console.log('  contribution :', r.contributionBps, 'bps');
console.log('  receipt      :', r.receiptUrl);