import { appendFileSync } from "fs"

class BaseLogger {
    protected format(message: string): string {
        return `[${new Date().toISOString()}] ${message}`
    }

    protected write(_message: string): void {
        throw new Error("write() must be implemented by subclass")
    }

    log(message: string): void {
        this.write(this.format(message))
    }
}

export class FileLogger extends BaseLogger {
    constructor(private readonly path: string) {
        super()
    }

    protected write(message: string): void {
        appendFileSync(this.path, message + "\n", "utf-8")
    }
}
