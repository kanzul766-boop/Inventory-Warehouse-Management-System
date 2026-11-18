import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

const testPrivateKey = "synthetic-imagekit-private-key-for-tests";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/inventory-imagekit-test";
process.env.JWT_SECRET = "test-jwt-secret-with-at-least-32-bytes";
process.env.IMAGEKIT_PRIVATE_KEY = testPrivateKey;
process.env.IMAGEKIT_PUBLIC_KEY = "synthetic-imagekit-public-key";
process.env.IMAGEKIT_URL_ENDPOINT = "https://ik.imagekit.io/test-account";

const [{ getUploadAuth }, { validateImageBuffer }] = await Promise.all([
    import("../src/controllers/upload.controller.js"),
    import("../services/storage.service.js")
]);

function createResponse() {
    return {
        headers: {},
        statusCode: 0,
        body: null,
        set(name, value) {
            this.headers[name.toLowerCase()] = value;
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

test("upload authentication returns signed short-lived credentials without the private key", () => {
    const response = createResponse();
    const now = Math.floor(Date.now() / 1000);

    getUploadAuth({}, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.body.publicKey, "synthetic-imagekit-public-key");
    assert.equal(response.body.urlEndpoint, "https://ik.imagekit.io/test-account");
    assert.ok(response.body.expire >= now + 600 && response.body.expire <= now + 601);
    assert.equal(
        response.body.signature,
        createHmac("sha1", testPrivateKey)
            .update(response.body.token + response.body.expire)
            .digest("hex")
    );
    assert.equal(JSON.stringify(response.body).includes(testPrivateKey), false);
});

test("server-side image validation rejects unsupported and oversized files", () => {
    const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    assert.doesNotThrow(() => validateImageBuffer(pngHeader));

    assert.throws(
        () => validateImageBuffer(Buffer.from("not an image")),
        error => error.status === 400
    );

    const oversizedImage = Buffer.alloc(5 * 1024 * 1024 + 1);
    pngHeader.copy(oversizedImage);
    assert.throws(
        () => validateImageBuffer(oversizedImage),
        error => error.status === 400
    );
});
