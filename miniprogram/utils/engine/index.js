/* 由 npm run build 生成，禁止手改 */
const CatChess = {};
Object.assign(CatChess, require('./core.js'), require('./solver.js'), require('./hint.js'), require('./generator.js'), require('./genconfig.js'));
module.exports = CatChess;
