// Resume keyword match: the skills and tools a job names, and whether the resume says them.
// Recruiters search applicant systems for exact words, so a missing keyword can hide a real match.
// Deterministic and free (no AI). Hirivo only ever says "add it if it's true".

const TERMS: { term: string; aliases?: string[] }[] = [
  { term: 'JavaScript', aliases: ['js', 'ecmascript'] }, { term: 'TypeScript', aliases: ['ts'] }, { term: 'React', aliases: ['react.js', 'reactjs'] },
  { term: 'Next.js', aliases: ['nextjs'] }, { term: 'Node.js', aliases: ['nodejs', 'node'] }, { term: 'Express' }, { term: 'Vue', aliases: ['vue.js'] },
  { term: 'Angular' }, { term: 'Svelte' }, { term: 'Redux' }, { term: 'HTML' }, { term: 'CSS' }, { term: 'Tailwind' }, { term: 'GraphQL' },
  { term: 'REST', aliases: ['restful', 'rest api', 'rest apis'] }, { term: 'gRPC' }, { term: 'Python' }, { term: 'Django' }, { term: 'Flask' },
  { term: 'FastAPI' }, { term: 'Java' }, { term: 'Spring', aliases: ['spring boot'] }, { term: 'Kotlin' }, { term: 'Swift' }, { term: 'Go', aliases: ['golang'] },
  { term: 'Rust' }, { term: 'C++' }, { term: 'C#' }, { term: '.NET', aliases: ['dotnet'] }, { term: 'PHP' }, { term: 'Ruby', aliases: ['rails', 'ruby on rails'] },
  { term: 'SQL' }, { term: 'PostgreSQL', aliases: ['postgres'] }, { term: 'MySQL' }, { term: 'MongoDB' }, { term: 'Redis' }, { term: 'Elasticsearch' },
  { term: 'Kafka' }, { term: 'RabbitMQ' }, { term: 'Spark' }, { term: 'Airflow' }, { term: 'dbt' }, { term: 'Snowflake' }, { term: 'BigQuery' },
  { term: 'Docker' }, { term: 'Kubernetes', aliases: ['k8s'] }, { term: 'Terraform' }, { term: 'AWS' }, { term: 'GCP', aliases: ['google cloud'] },
  { term: 'Azure' }, { term: 'Linux' }, { term: 'CI/CD', aliases: ['ci cd', 'continuous integration'] }, { term: 'Git' }, { term: 'Microservices' },
  { term: 'Distributed systems' }, { term: 'System design' }, { term: 'Machine learning', aliases: ['ml'] }, { term: 'Deep learning' },
  { term: 'PyTorch' }, { term: 'TensorFlow' }, { term: 'LLM', aliases: ['llms', 'large language models'] }, { term: 'NLP' }, { term: 'Pandas' },
  { term: 'Power BI' }, { term: 'Tableau' }, { term: 'Excel' }, { term: 'Statistics' }, { term: 'A/B testing', aliases: ['ab testing', 'experimentation'] },
  { term: 'Figma' }, { term: 'Android' }, { term: 'iOS' }, { term: 'Flutter' }, { term: 'React Native' }, { term: 'Jest' }, { term: 'Playwright' },
  { term: 'Cypress' }, { term: 'Selenium' }, { term: 'Testing', aliases: ['unit testing', 'test automation'] }, { term: 'Agile', aliases: ['scrum'] },
  { term: 'Jira' }, { term: 'Payments', aliases: ['payment gateway', 'upi'] }, { term: 'Security', aliases: ['appsec'] }, { term: 'Observability', aliases: ['monitoring', 'grafana', 'prometheus'] },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const patternFor = (words: string[]) => new RegExp(`(^|[^a-z0-9+#.])(?:${words.map(escape).join('|')})(?=$|[^a-z0-9+#])`, 'gi');
const PATTERNS = TERMS.map((t) => ({ term: t.term, re: patternFor([t.term.toLowerCase(), ...(t.aliases || [])]) }));

export interface KeywordMatch {
  present: string[];
  missing: string[];
  share: number; // 0-100, present / all keywords the job names
}

/** Keywords the job names, most mentioned first, and whether the resume has them. */
export function keywordMatch(jobText: string, resumeText: string): KeywordMatch {
  const job = jobText.toLowerCase();
  const resume = resumeText.toLowerCase();
  const named = PATTERNS.map(({ term, re }) => ({ term, count: (job.match(re) || []).length, re }))
    .filter((k) => k.count > 0)
    // "Go" and "Git" are common words; require them to be named more than once or in a tech list.
    .filter((k) => !(['Go', 'REST', 'Testing', 'Security', 'Payments'].includes(k.term) && k.count < 2 && !/\b(?:go|golang)\s*[,/]/i.test(jobText)))
    .sort((a, b) => b.count - a.count);
  const present = named.filter((k) => resume.match(k.re)).map((k) => k.term);
  const missing = named.filter((k) => !resume.match(k.re)).map((k) => k.term);
  return { present, missing, share: named.length ? Math.round((present.length / named.length) * 100) : 0 };
}
