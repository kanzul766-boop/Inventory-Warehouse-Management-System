import app from "./src/app.js"
import connectDB from "./src/db/db.js"
import { PORT } from "./src/config/env.js"

try {
    await connectDB()
    app.listen(PORT, () => {
        console.log(`Example app listening on port ${PORT}`)
    })
} catch (error) {
    const isMongoAuthenticationError =
        error instanceof Error &&
        /bad auth|authentication failed/i.test(error.message)

    if (isMongoAuthenticationError) {
        console.error(
            "Failed to start server: MongoDB authentication failed. Verify the Atlas Database Access username and password."
        )
    } else {
        console.error(
            "Failed to start server. Error type:",
            error instanceof Error ? error.name : "UnknownError"
        )
    }
    process.exitCode = 1
}