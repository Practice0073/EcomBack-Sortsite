import { syncRuleCatalog } from '../engine/rules/catalog.js';
import { ensureSeed, DEFAULT_ADMIN } from './seedData.js';

syncRuleCatalog();
ensureSeed();
console.log(`Database ready. Admin: ${DEFAULT_ADMIN.email}`);
