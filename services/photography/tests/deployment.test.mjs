import {test} from 'node:test'
import assert from 'node:assert/strict'
import {requestOrigin} from '../server/index.mjs'

test('SSH setup accepts only the exact loopback host from a loopback connection',()=>{
  const publicOrigin='http://10.10.10.61:3009'
  const request=(remoteAddress,host)=>({socket:{remoteAddress},headers:{host}})
  assert.equal(requestOrigin(request('127.0.0.1','127.0.0.1:3009'),3009,publicOrigin),'http://127.0.0.1:3009')
  assert.equal(requestOrigin(request('::ffff:127.0.0.1','127.0.0.1:3009'),3009,publicOrigin),'http://127.0.0.1:3009')
  assert.equal(requestOrigin(request('10.10.10.42','127.0.0.1:3009'),3009,publicOrigin),publicOrigin)
  assert.equal(requestOrigin(request('127.0.0.1','attacker.test:3009'),3009,publicOrigin),publicOrigin)
  assert.equal(requestOrigin(request('127.0.0.1','10.10.10.61:3009'),3009,publicOrigin),publicOrigin)
})
