import type { Todo } from "./models"

let nextId = 1

export class TodoStore {
    private todos: Todo[] = []

    add(title: string): Todo {
        const todo: Todo = { id: nextId++, title, done: false }
        this.todos.push(todo)
        return todo
    }

    remove(id: number): boolean {
        if (id < 0 || id >= this.todos.length) return false
        this.todos.splice(id, 1)
        return true
    }

    list(): Todo[] {
        return [...this.todos]
    }
}
