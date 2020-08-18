exports.getPromptsHeading = (config) => {
  return 'This module needs information'
}

exports.getPrompts = (config) => {
  return {
    type: 'number',
    name: 'age',
    message: 'How old are you?',
    validate: value => value < 18 ? 'Nightclub is 18+ only' : true
  }
}

exports.prePrompts = (config) => {
  console.log('Pre prompts')
}

exports.preAdd = (config) => {
  console.log('Pre add')
}

exports.postAdd = (config) => {
  console.log('Post add')
}
