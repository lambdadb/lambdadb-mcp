export function jsonResult(title: string, data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${title}\n\n${JSON.stringify(data, null, 2)}`
      }
    ]
  };
}

