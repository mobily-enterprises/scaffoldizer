# Scaffoldizer

Scaffoldizer allows you to write application scaffolds in the easiest possible way.
A "scaffold" can be a purposefully crafted NPM module, or a directory.

## Installation

Install Scaffoldizer in the global space:

````
$ npm i -g scaffoldizer
````

## Basic use

````
$ mkdir example-app
$ cd example-app
$ npm init
$ # ... answer basic questions
$ add scaffoldizer-example .
````

Thiis command will enrich the current project (`.`) with the `scaffoldizer-example` scaffold, which will enrich it.

## Get your hands dirty

There is no documentation yet. However, by looking at the "example" directory in this project will give you a good idea on how to create your own scaffolds.
