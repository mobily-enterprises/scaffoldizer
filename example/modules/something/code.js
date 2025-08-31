export const getPromptsHeading = (config) => {
  return 'This module needs information'
}

export const getPrompts = (config) => {
  return {
    type: 'number',
    name: 'age',
    message: 'How old are you?',
    validate: value => value < 18 ? 'Nightclub is 18+ only' : true
  }
}

export const prePrompts = (config) => {
  console.log('Pre prompts')
}

export const preAdd = (config) => {
  console.log('Pre add')
}

export const postAdd = (config) => {
  console.log('Post add')
}
