import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/inventory-auth-test";
process.env.JWT_SECRET = "test-jwt-secret-with-at-least-32-bytes";
process.env.IMAGEKIT_PRIVATE_KEY = "test-imagekit-private-key";
process.env.FRONTEND_ORIGIN = "https://frontend.test";
process.env.NODE_ENV = "test";

const [{ default: app }, { default: userModel }, { default: bcrypt }, { default: jwt }, env, { default: mongoose }] =
    await Promise.all([
        import("../src/app.js"),
        import("../src/models/users.model.js"),
        import("bcryptjs"),
        import("jsonwebtoken"),
        import("../src/config/env.js"),
        import("mongoose")
    ]);

const originalFindOne = userModel.findOne;
const originalFindById = userModel.findById;

function mockedQuery(value) {
    return {
        select() {
            return this;
        },
        lean() {
            return this;
        },
        then(resolve, reject) {
            return Promise.resolve(value).then(resolve, reject);
        }
    };
}

test("login cookie restores the session, expires consistently, and logout clears it", async () => {
    const user = {
        _id: new mongoose.Types.ObjectId(),
        username: "session-test-user",
        name: "Session Test",
        email: "session-test@example.test",
        role: "salesRepresentative",
        password: await bcrypt.hash("test-session-password-123", 4),
        assignedWarehouses: []
    };
    userModel.findOne = () => mockedQuery(user);
    userModel.findById = () => mockedQuery(user);

    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const originHeaders = { Origin: env.FRONTEND_ORIGIN };

    try {
        const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { ...originHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({
                username: user.username,
                password: "test-session-password-123"
            })
        });
        assert.equal(loginResponse.status, 200);
        assert.equal(
            loginResponse.headers.get("access-control-allow-origin"),
            env.FRONTEND_ORIGIN
        );
        assert.equal(loginResponse.headers.get("access-control-allow-credentials"), "true");
        assert.equal((await loginResponse.json()).user.role, user.role);

        const setCookie = loginResponse.headers.get("set-cookie") || "";
        assert.match(setCookie, /HttpOnly/i);
        assert.match(setCookie, /Secure/i);
        assert.match(setCookie, /SameSite=None/i);
        assert.match(setCookie, /Path=\//i);
        assert.match(setCookie, new RegExp(`Max-Age=${env.JWT_EXPIRES_IN_SECONDS}`));

        const cookiePair = setCookie.split(";", 1)[0];
        const token = decodeURIComponent(cookiePair.slice("token=".length));
        const claims = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
        assert.equal(claims.exp - claims.iat, env.JWT_EXPIRES_IN_SECONDS);

        const restoredResponse = await fetch(`${baseUrl}/api/auth/me`, {
            headers: { ...originHeaders, Cookie: cookiePair }
        });
        assert.equal(restoredResponse.status, 200);
        const restoredPayload = await restoredResponse.json();
        assert.equal(restoredPayload.user.id, user._id.toString());
        assert.equal(restoredPayload.user.role, user.role);
        assert.equal("password" in restoredPayload.user, false);

        const expiredToken = jwt.sign(
            { id: user._id.toString(), role: user.role },
            env.JWT_SECRET,
            { algorithm: "HS256", expiresIn: -1 }
        );
        const expiredResponse = await fetch(`${baseUrl}/api/auth/me`, {
            headers: { ...originHeaders, Cookie: `token=${expiredToken}` }
        });
        assert.equal(expiredResponse.status, 401);

        const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
            method: "POST",
            headers: { ...originHeaders, Cookie: cookiePair }
        });
        assert.equal(logoutResponse.status, 200);
        const clearedCookie = logoutResponse.headers.get("set-cookie") || "";
        assert.match(clearedCookie, /HttpOnly/i);
        assert.match(clearedCookie, /Secure/i);
        assert.match(clearedCookie, /SameSite=None/i);
        assert.match(clearedCookie, /(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i);

        const loggedOutResponse = await fetch(`${baseUrl}/api/auth/me`, {
            headers: originHeaders
        });
        assert.equal(loggedOutResponse.status, 401);
    } finally {
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
});

after(() => {
    userModel.findOne = originalFindOne;
    userModel.findById = originalFindById;
});
