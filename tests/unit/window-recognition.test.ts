import { expect, it } from 'vitest';
import { memoryDb } from '../../src/backend/adapters/sqlite/repository';
import { catalogFromDb } from '../../src/backend/adapters/sqlite/recognition';
import { recognizeWindow, type WindowCatalog } from '../../src/backend/application/window-recognition';

it('suggests the open case with a reference in the file name at high confidence',()=>{
  const db=memoryDb();
  try {
    const result=recognizeWindow('2025-031 Opposition Brief v3.docx','Word',catalogFromDb(db) as WindowCatalog);
    expect(result).toMatchObject({confidence:'high',suggestion:{title:'Dawson v Martin'}});
  }finally{db.close();}
});

it('keeps client-only matches ambiguous and offers alternatives',()=>{
  const db=memoryDb();
  try {
    const catalog=catalogFromDb(db) as WindowCatalog;
    const dawson=catalog.matters.find(item=>item.title==='Dawson v Martin')!;
    catalog.matters.push({...dawson,id:999,title:'Another Dawson case',reference:'2026-999'});
    const result=recognizeWindow('Paul Dawson notes.docx','Word',catalog);
    expect(result.confidence).toBe('low');
    expect(result.alternatives).toContainEqual(expect.objectContaining({title:'Another Dawson case'}));
  }finally{db.close();}
});

it('returns no suggestion for an unmatched file',()=>{
  const db=memoryDb();
  try {
    expect(recognizeWindow('Unrelated notes.docx','Word',catalogFromDb(db) as WindowCatalog)).toMatchObject({suggestion:null,alternatives:[],confidence:'low'});
  }finally{db.close();}
});

it('asks for confirmation without a countdown for a research file matched only by a file marker',()=>{
  const db=memoryDb();
  try {
    expect(recognizeWindow('Research - notice of appeal deadline for family court orders.docx','Word',catalogFromDb(db) as WindowCatalog).confidence).toBe('low');
  }finally{db.close();}
});
