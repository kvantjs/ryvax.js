import fs from 'node:fs';

const schema = JSON.parse(fs.readFileSync('docs/seo/ryvax-jsonld.json', 'utf8'));
const config = JSON.parse(fs.readFileSync('scalar.config.json', 'utf8'));
const types = new Set(schema['@graph'].map((item) => item['@type']));
if (schema['@context'] !== 'https://schema.org' || !types.has('SoftwareApplication') || !types.has('TechArticle')) {
  throw new Error('Schema.org graph is missing the required entity types');
}
const head = config.siteConfig?.head;
if (head?.meta?.[0]?.name !== 'description' || !head.scripts?.some((script) => script.path === 'docs/seo/ryvax-jsonld.js')) {
  throw new Error('Scalar head does not reference SEO metadata and JSON-LD');
}
const home = fs.readFileSync('docs/site/index.mdx', 'utf8');
if (!home.includes('Ryvax.js') || !home.includes('React-first full-stack TypeScript framework')) {
  throw new Error('Home entity description is missing');
}
console.log('SEO/GEO validation passed');
