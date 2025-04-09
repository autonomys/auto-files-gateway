import {} from 'k6'

export const loadEnv = () => {
  try {
    // Use a relative path that k6 can understand
    const fileContent = open(`${__ENV.PWD}/../.env.benchmarks`)

    if (!fileContent) {
      console.error('Failed to open .env.benchmarks file')
      return
    }

    const lines = fileContent.split('\n')

    const envVars = lines
      .map((line) => {
        // Skip empty lines and comments
        if (!line || line.trim().startsWith('#')) {
          return null
        }

        const parts = line.split('=', 2)
        if (parts.length < 2) {
          throw new Error(`Invalid line: ${line}`)
        }

        const key = parts[0].trim()
        const value = parts[1].trim()

        return [key, value]
      })
      .filter(Boolean)

    for (const entry of envVars) {
      if (!entry) {
        continue
      }

      const [key, value] = entry
      global[key] = value
    }
  } catch (error) {
    console.error(`Error loading environment variables: ${error.message}`)
    throw error
  }
}
