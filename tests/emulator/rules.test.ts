import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-qawwam',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8181 },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe('security rules (NFR-008)', () => {
  it('lets a user read and write only their own data', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'users/alice/todo_items/t1'), { title: 'Mine' }));
    await assertSucceeds(getDoc(doc(alice(), 'users/alice/todo_items/t1')));
    await assertSucceeds(setDoc(doc(alice(), 'users/alice'), { display_name: 'Alice' }));
    await assertFails(getDoc(doc(bob(), 'users/alice/todo_items/t1')));
    await assertFails(setDoc(doc(bob(), 'users/alice/todo_items/t2'), { title: 'Not mine' }));
    await assertFails(deleteDoc(doc(bob(), 'users/alice/todo_items/t1')));
    await assertFails(getDoc(doc(bob(), 'users/alice')));
  });

  it('blocks anyone who is not signed in', async () => {
    await assertFails(getDoc(doc(anon(), 'users/alice/wallets/w1')));
    await assertFails(setDoc(doc(anon(), 'users/alice/wallets/w1'), { balance: 100 }));
  });

  it('blocks everything outside users/{uid}', async () => {
    await assertFails(setDoc(doc(alice(), 'shared/x'), { a: 1 }));
    await assertFails(getDoc(doc(alice(), 'shared/x')));
  });

  it('requires good habits to add points and bad habits to remove them', async () => {
    const db = alice();
    await assertSucceeds(setDoc(doc(db, 'users/alice/habits/g'), { type: 'good', points: 5 }));
    await assertSucceeds(setDoc(doc(db, 'users/alice/habits/b'), { type: 'bad', points: -10 }));
    await assertFails(setDoc(doc(db, 'users/alice/habits/x'), { type: 'bad', points: 10 }));
    await assertFails(setDoc(doc(db, 'users/alice/habits/y'), { type: 'good', points: -1 }));
    await assertFails(setDoc(doc(db, 'users/alice/habits/z'), { type: 'meh', points: 1 }));
    await assertFails(updateDoc(doc(db, 'users/alice/habits/g'), { points: 2.5 }));
  });

  it('only accepts money in whole sen', async () => {
    const db = alice();
    await assertSucceeds(setDoc(doc(db, 'users/alice/wallets/w'), { balance: 1290 }));
    await assertFails(setDoc(doc(db, 'users/alice/wallets/w2'), { balance: 12.9 }));
    await assertFails(setDoc(doc(db, 'users/alice/transactions/t'), { amount: -12.5 }));
    await assertFails(setDoc(doc(db, 'users/alice/money_items/i'), { amount: '40' }));
    await assertSucceeds(setDoc(doc(db, 'users/alice/transactions/t'), { amount: -1250 }));
  });
});
