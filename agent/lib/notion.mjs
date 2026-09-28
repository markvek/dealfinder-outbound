import { request } from './http.mjs';
import { parseRules } from './rules.mjs';

export const rich = text => [{ type: 'text', text: { content: String(text).slice(0, 1900) } }];
export const block = (text, type = 'paragraph') => ({ object: 'block', type, [type]: { rich_text: rich(text) } });
const title = text => ({ title: rich(text) });
const text = value => ({ rich_text: rich(value) });
const propertyText = property => (property?.rich_text || property?.title || []).map(t => t.plain_text ?? t.text?.content ?? '').join('');

export class Notion {
  constructor(token, config, transport = request) { this.token = token; this.config = config; this.transport = transport; }
  api(route, body, method = body === undefined ? 'GET' : 'POST') {
    return this.transport(`https://api.notion.com/v1/${route}`, {
      service: 'Notion', method, body, headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': '2026-03-11' },
      retrySafe: method === 'GET' || method === 'PATCH' || route.endsWith('/query'),
    });
  }
  async list(route, body) {
    const results = [];
    let cursor;
    do {
      const page = body === undefined
        ? await this.api(`${route}${route.includes('?') ? '&' : '?'}page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`)
        : await this.api(route, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      results.push(...page.results);
      if (page.request_status?.type === 'incomplete') throw new Error('Notion returned incomplete results. Narrow or archive the workspace before continuing.');
      cursor = page.has_more ? page.next_cursor : null;
      if (page.has_more && !cursor) throw new Error('Notion returned an incomplete pagination cursor.');
    } while (cursor);
    return results;
  }
  async blocks(id, depth = 0) {
    if (depth > 10) throw new Error('Sourcing Rules nesting exceeds 10 levels.');
    const out = [];
    for (const item of await this.list(`blocks/${id}/children`)) {
      out.push(item);
      if (item.has_children && !['child_page', 'child_database'].includes(item.type)) out.push(...await this.blocks(item.id, depth + 1));
    }
    if (out.length > 1000) throw new Error('Sourcing Rules is too large; keep it under 1,000 blocks.');
    return out;
  }
  async rules() { return parseRules(await this.blocks(this.config.rulesPage)); }
  async companies() {
    return (await this.list(`data_sources/${this.config.ideasSource}/query`, {})).map(p => ({
      id: p.id, domain: propertyText(p.properties.Domain), run: propertyText(p.properties.Run),
    }));
  }
  async findRun(key) {
    const pages = await this.list(`data_sources/${this.config.runsSource}/query`, { filter: { property: 'Name', title: { equals: key } } });
    if (pages.length > 1) throw new Error('Duplicate Run History entries found. Stop other computers running this workspace.');
    if (!pages[0]) return null;
    const p = pages[0];
    return { id: p.id, status: p.properties.Status.select?.name, attempts: p.properties.Attempts.number || 0,
      calls: p.properties.Calls.number || 0, count: p.properties.Count.number || 0 };
  }
  async latestRunKey() {
    const page = await this.api(`data_sources/${this.config.runsSource}/query`, {
      filter: { property: 'Name', title: { does_not_contain: 'Test ' } },
      page_size: 1, sorts: [{ property: 'Name', direction: 'descending' }],
    });
    return page.results[0] ? propertyText(page.results[0].properties.Name) : null;
  }
  createRun(key, rules) {
    return this.api('pages', { parent: { type: 'data_source_id', data_source_id: this.config.runsSource },
      properties: { Name: title(key), Status: { select: { name: 'Running' } }, Target: { number: rules.dailyTarget },
        Count: { number: 0 }, Attempts: { number: 0 }, Calls: { number: 0 }, Updated: { date: { start: new Date().toISOString() } } },
      children: [block('Rules used for this run', 'heading_2'), ...rules.instructions.match(/[\s\S]{1,1800}/g).map(t => block(t))],
    });
  }
  updateRun(id, { status, count, attempts, calls, note }) {
    return this.api(`pages/${id}`, { properties: { Status: { select: { name: status } }, Count: { number: count },
      Attempts: { number: attempts }, Calls: { number: calls }, Notes: text(note || ''),
      Updated: { date: { start: new Date().toISOString() } } } }, 'PATCH');
  }
  addCompany(company, run) {
    return this.api('pages', { parent: { type: 'data_source_id', data_source_id: this.config.ideasSource },
      properties: { Name: title(company.name), Website: { url: company.website }, Domain: text(company.domain),
        Description: text(company.description), 'Why it fits': text(company.fit), Status: { select: { name: 'New' } },
        Found: { date: { start: new Date().toISOString() } }, Run: text(run) },
      children: [block(company.description), block('Why it fits', 'heading_2'), block(company.fit),
        block('Evidence', 'heading_2'), ...company.sources.map(s => ({ object: 'block', type: 'paragraph', paragraph: {
          rich_text: [{ type: 'text', text: { content: s.title.slice(0, 500), link: { url: s.url } } },
            ...rich(` — ${s.evidence}`)],
        } })), block('CRM status', 'heading_2'),
        block('Needs CRM review — no CRM connection is configured. Ownership, outreach and last-contact date have not been checked.'),
        block('Review notes', 'heading_2'), block('Add your notes here.')],
    });
  }
  async verify() {
    await this.api(`pages/${this.config.parentPage}`);
    if (this.config.rulesPage) await this.api(`pages/${this.config.rulesPage}`);
    for (const [key, schema] of [['ideasSource', ideaProperties], ['runsSource', runProperties]]) {
      if (!this.config[key]) continue;
      const source = await this.api(`data_sources/${this.config[key]}`);
      for (const [name, shape] of Object.entries(schema)) {
        if (source.properties[name]?.type !== Object.keys(shape)[0]) throw new Error(`Notion database needs the ${name} property (${Object.keys(shape)[0]}).`);
      }
    }
  }
}

export const ideaProperties = {
  Name: { title: {} }, Website: { url: {} }, Domain: { rich_text: {} }, Description: { rich_text: {} },
  'Why it fits': { rich_text: {} }, Found: { date: {} }, Run: { rich_text: {} },
  Status: { select: { options: ['New', 'Shortlisted', 'Rejected'].map(name => ({ name })) } },
};
export const runProperties = {
  Name: { title: {} }, Status: { select: { options: ['Running', 'Complete', 'Shortfall', 'Error', 'Stopped'].map(name => ({ name })) } },
  Target: { number: {} }, Count: { number: {} }, Attempts: { number: {} }, Calls: { number: {} },
  Updated: { date: {} }, Notes: { rich_text: {} },
};

// Discover existing named children before creating anything, including after a
// setup interruption. Existing databases are schema-checked before use.
export async function provision(notion, config, controls, save) {
  const children = await notion.list(`blocks/${config.parentPage}/children`);
  const existing = (type, name) => {
    const matches = children.filter(b => b.type === type && b[type].title === name);
    if (matches.length > 1) throw new Error(`Multiple ${name} pages found. Keep one before running setup again.`);
    return matches[0]?.id;
  };
  if (!config.rulesPage) {
    config.rulesPage = existing('child_page', 'Sourcing Rules') || (await notion.api('pages', {
      parent: { type: 'page_id', page_id: config.parentPage }, properties: { title: title('Sourcing Rules') },
      children: [block('Edit the rules below, then change enabled to true. Times use the timezone you specify. The agent checks every 15 minutes.'),
        { object: 'block', type: 'code', code: { language: 'json', rich_text: rich(JSON.stringify(controls, null, 2)) } },
        block('Who to source', 'heading_2'), block('[REPLACE WITH YOUR SOURCING RULES]'),
        block('Describe industries, location, company size, buying signals, exclusions, and good-fit / bad-fit examples. Keep instructions on this page; linked pages are not read.')],
    })).id;
    await save(config);
  }
  for (const [key, sourceKey, name, properties] of [
    ['ideasDatabase', 'ideasSource', 'Company Ideas', ideaProperties], ['runsDatabase', 'runsSource', 'Run History', runProperties],
  ]) {
    if (!config[key]) {
      config[key] = existing('child_database', name) || (await notion.api('databases', {
        parent: { type: 'page_id', page_id: config.parentPage }, title: rich(name), initial_data_source: { properties },
      })).id;
      await save(config);
    }
    if (!config[sourceKey]) {
      const db = await notion.api(`databases/${config[key]}`);
      if (db.data_sources?.length !== 1) throw new Error(`${name} must have exactly one data source.`);
      config[sourceKey] = db.data_sources[0].id;
      await save(config);
    }
  }
  if (!config.galleryCreated) {
    // Listing makes setup safe to repeat after a successful but unacknowledged write.
    const references = await notion.list(`views?database_id=${config.ideasDatabase}`);
    const views = [];
    for (const ref of references) views.push(await notion.api(`views/${ref.id}`));
    if (!views.some(v => v.type === 'gallery')) await notion.api('views', {
      database_id: config.ideasDatabase, data_source_id: config.ideasSource, name: 'Company grid', type: 'gallery',
      position: { type: 'start' },
    });
    config.galleryCreated = true;
    await save(config);
  }
  await notion.verify();
}
