// REQUIREMENT: authorization, unauthorized account access, role permissions
const { pool, request, app, createUser, createAccount, deposit, post, get, auth, balanceOf } = require('./helpers');

afterAll(() => pool.end());

describe('Authentication basics', () => {
    test('registration ignores a requested role and always gives ACCOUNT_HOLDER', async () => {
        const res = await request(app).post('/api/auth/register').send({
            name: 'Sneaky', email: `sneaky_${Date.now()}@example.com`,
            password: 'Password123', role: 'ADMIN'
        });
        expect(res.status).toBe(201);
        expect(res.body.role).toBe('ACCOUNT_HOLDER');
    });

    test('requests without a token get 401', async () => {
        expect((await get(null, '/api/accounts')).status).toBe(401);
        expect((await post(null, '/api/transactions/deposit', { accountId: 2, amount: '1' })).status).toBe(401);
    });

    test('a garbage token gets 401', async () => {
        const res = await request(app).get('/api/accounts').set('Authorization', 'Bearer not.a.token');
        expect(res.status).toBe(401);
    });

    test('wrong password gets 401', async () => {
        const user = await createUser();
        const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'WrongPass999' });
        expect(res.status).toBe(401);
    });
});

describe('Unauthorized account access', () => {
    let alice, bob, a, b;

    beforeAll(async () => {
        alice = await createUser();
        bob = await createUser();
        a = await createAccount(alice, 'Alice Private');
        b = await createAccount(bob, 'Bob Private');
        await deposit(alice, a, '100.00');
    });

    test("Bob cannot view Alice's account or statement", async () => {
        expect((await get(bob, `/api/accounts/${a}`)).status).toBe(403);
        expect((await get(bob, `/api/accounts/${a}/statement`)).status).toBe(403);
    });

    test("Bob cannot withdraw from, deposit into, or transfer out of Alice's account", async () => {
        expect((await post(bob, '/api/transactions/withdraw', { accountId: a, amount: '1' })).status).toBe(403);
        expect((await post(bob, '/api/transactions/deposit', { accountId: a, amount: '1' })).status).toBe(403);
        expect((await post(bob, '/api/transactions/transfer',
            { fromAccountId: a, toAccountId: b, amount: '1' })).status).toBe(403);
        expect(await balanceOf(alice, a)).toBe('100.00');
    });

    test("Bob's account list contains only his own accounts", async () => {
        const res = await get(bob, '/api/accounts');
        expect(res.status).toBe(200);
        expect(res.body.accounts.every(x => x.ownerId === bob.id)).toBe(true);
    });

    test('an account holder cannot create an account for someone else via ownerId', async () => {
        const res = await post(bob, '/api/accounts', { accountName: 'Hijack', ownerId: alice.id });
        expect(res.status).toBe(201);
        expect(res.body.account.ownerId).toBe(bob.id);
    });

    test('the bank\'s EXTERNAL_CASH system account is invisible and untouchable', async () => {
        expect((await get(alice, '/api/accounts/1')).status).toBe(404);
        expect((await post(alice, '/api/transactions/withdraw', { accountId: 1, amount: '1' })).status).toBe(403);
        expect((await post(alice, '/api/transactions/transfer',
            { fromAccountId: a, toAccountId: 1, amount: '1' })).status).toBe(404);
    });
});

describe('Role permissions', () => {
    let alice, a, auditor, admin;

    beforeAll(async () => {
        alice = await createUser();
        a = await createAccount(alice);
        await deposit(alice, a, '50.00');
        auditor = await createUser('AUDITOR');
        admin = await createUser('ADMIN');
    });

    test('AUDITOR can read all accounts and statements', async () => {
        const list = await get(auditor, '/api/accounts');
        expect(list.status).toBe(200);
        expect(list.body.accounts.some(x => x.id === a)).toBe(true);
        expect((await get(auditor, `/api/accounts/${a}`)).status).toBe(200);
        expect((await get(auditor, `/api/accounts/${a}/statement`)).status).toBe(200);
    });

    test('AUDITOR is read-only: cannot deposit, withdraw, transfer or create accounts', async () => {
        expect((await post(auditor, '/api/transactions/deposit', { accountId: a, amount: '1' })).status).toBe(403);
        expect((await post(auditor, '/api/transactions/withdraw', { accountId: a, amount: '1' })).status).toBe(403);
        expect((await post(auditor, '/api/transactions/transfer',
            { fromAccountId: a, toAccountId: a, amount: '1' })).status).toBe(403);
        expect((await post(auditor, '/api/accounts', { accountName: 'x' })).status).toBe(403);
        expect(await balanceOf(alice, a)).toBe('50.00');
    });

    test('ADMIN can create an account on behalf of a customer', async () => {
        const res = await post(admin, '/api/accounts', { accountName: 'Admin opened', ownerId: alice.id });
        expect(res.status).toBe(201);
        expect(res.body.account.ownerId).toBe(alice.id);
    });

    test('ADMIN needs an ownerId, and it must be a real account holder', async () => {
        expect((await post(admin, '/api/accounts', { accountName: 'x' })).status).toBe(400);
        expect((await post(admin, '/api/accounts', { accountName: 'x', ownerId: 99999999 })).status).toBe(404);
    });

    test('ADMIN cannot move customers\' money', async () => {
        expect((await post(admin, '/api/transactions/withdraw', { accountId: a, amount: '1' })).status).toBe(403);
        expect((await post(admin, '/api/transactions/deposit', { accountId: a, amount: '1' })).status).toBe(403);
    });

    test('ACCOUNT_HOLDER cannot reach admin or auditor routes', async () => {
        expect((await get(alice, '/api/auth/admin')).status).toBe(403);
        expect((await get(alice, '/api/auth/auditor')).status).toBe(403);
    });

    test('ADMIN reaches the admin route', async () => {
        expect((await get(admin, '/api/auth/admin')).status).toBe(200);
    });

    test('validation: account name is required', async () => {
        expect((await post(alice, '/api/accounts', {})).status).toBe(400);
    });
});
