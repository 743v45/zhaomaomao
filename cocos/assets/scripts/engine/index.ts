/* 由 npm run build 自动生成（禁止手改） */
import core from './core';
import solver from './solver';
import hint from './hint';
const CatChess: any = Object.assign({}, core(), solver(), hint());
export default CatChess;
