require('dotenv').config();
const { Pool } = require('pg');
const OpenAI = require('openai');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const GUIDELINES = [
  {
    source: 'ADA 2024',
    title: 'Diagnóstico de Diabetes Mellitus',
    content: 'Glicemia de jejum ≥126 mg/dL em duas ocasiões = DM. 100-125 = pré-diabetes. HbA1c ≥6,5% = DM. 5,7-6,4% = pré-diabetes.'
  },
  {
    source: 'ADA 2024',
    title: 'Avaliação da Função Tireoidiana',
    content: 'TSH normal: 0,4-4,0 mUI/L. TSH >4,0 = hipotireoidismo. TSH <0,4 = hipertireoidismo. T4 livre normal: 0,8-1,8 ng/dL.'
  },
  {
    source: 'SBC 2023',
    title: 'Dislipidemias e Risco Cardiovascular',
    content: 'LDL <100 = ótimo. 130-159 = limítrofe. ≥160 = alto. HDL <40 (H) / <50 (M) = baixo. Triglicerídeos >150 = limítrofe. >500 = risco de pancreatite.'
  },
  {
    source: 'SBC 2023',
    title: 'Colesterol Total',
    content: 'Colesterol total <170 = desejável. 170-199 = limítrofe. ≥200 = elevado.'
  },
  {
    source: 'WHO 2011',
    title: 'Definição de Anemia',
    content: 'Anemia: Hb <13 g/dL (homens), <12 g/dL (mulheres). Anemia grave: Hb <8 g/dL. Microcítica: VCM <80 fL (sugere deficiência de ferro).'
  },
  {
    source: 'SBH 2021',
    title: 'Interpretação do Hemograma',
    content: 'Leucócitos normais: 4.000-11.000/mm³. Leucocitose >11.000 sugere infecção. Leucopenia <4.000 sugere imunossupressão. Plaquetas normais: 150.000-400.000/mm³.'
  }
];

async function seedRag() {
  console.log('Seeding RAG knowledge base...');

  for (const doc of GUIDELINES) {
    const { data } = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: `${doc.title}: ${doc.content}`
    });
    const embedding = data[0].embedding;

    await pool.query(
      `INSERT INTO rag_documents (source, title, content, embedding)
       VALUES ($1, $2, $3, $4::vector)
       ON CONFLICT DO NOTHING`,
      [doc.source, doc.title, doc.content, `[${embedding.join(',')}]`]
    );

    console.log(`[seeded] ${doc.title}`);
  }

  console.log('Done.');
  await pool.end();
}

seedRag().catch(err => { console.error(err); process.exit(1); });
