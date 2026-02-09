import { jest } from '@jest/globals';
import * as serverModule from '../src/mailgun-mcp.js';

// Disable console.error and console.warn during tests
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
console.error = jest.fn();
console.warn = jest.fn();

// Override process.exit during tests
const originalProcessExit = process.exit;
process.exit = jest.fn();

describe('Mailgun MCP Server', () => {
  describe('processPathParameters()', () => {
    test('replaces path parameters with values', () => {
      const path = '/v3/{domain_name}/messages';
      const operation = {
        parameters: [
          { name: 'domain_name', in: 'path', required: true }
        ]
      };
      const params = { domain_name: 'example.com', to: 'test@example.com' };

      const result = serverModule.processPathParameters(path, operation, params);

      expect(result.actualPath).toBe('/v3/example.com/messages');
      expect(result.remainingParams).toEqual({ to: 'test@example.com' });
    });

    test('replaces multiple path parameters', () => {
      const path = '/v3/{domain_name}/templates/{template_name}';
      const operation = {
        parameters: [
          { name: 'domain_name', in: 'path', required: true },
          { name: 'template_name', in: 'path', required: true }
        ]
      };
      const params = { domain_name: 'example.com', template_name: 'welcome' };

      const result = serverModule.processPathParameters(path, operation, params);

      expect(result.actualPath).toBe('/v3/example.com/templates/welcome');
      expect(result.remainingParams).toEqual({});
    });

    test('URL-encodes path parameter values', () => {
      const path = '/v3/{domain_name}/bounces/{address}';
      const operation = {
        parameters: [
          { name: 'domain_name', in: 'path', required: true },
          { name: 'address', in: 'path', required: true }
        ]
      };
      const params = { domain_name: 'example.com', address: 'user@test.com' };

      const result = serverModule.processPathParameters(path, operation, params);

      expect(result.actualPath).toBe('/v3/example.com/bounces/user%40test.com');
    });

    test('handles operation with no parameters', () => {
      const path = '/v3/routes';
      const operation = {};
      const params = { limit: 10 };

      const result = serverModule.processPathParameters(path, operation, params);

      expect(result.actualPath).toBe('/v3/routes');
      expect(result.remainingParams).toEqual({ limit: 10 });
    });

    test('throws error if required path parameter is missing', () => {
      const path = '/v3/{domain_name}/messages';
      const operation = {
        parameters: [
          { name: 'domain_name', in: 'path', required: true }
        ]
      };
      const params = { to: 'test@example.com' };

      expect(() => {
        serverModule.processPathParameters(path, operation, params);
      }).toThrow(/required path parameter.*missing/i);
    });
  });

  describe('separateParameters()', () => {
    test('separates query and body parameters', () => {
      const params = {
        limit: 10,
        page: 1,
        to: 'test@example.com',
        from: 'sender@example.com'
      };
      const operation = {
        parameters: [
          { name: 'limit', in: 'query' },
          { name: 'page', in: 'query' }
        ]
      };

      const result = serverModule.separateParameters(params, operation, 'POST');

      expect(result.queryParams).toEqual({ limit: 10, page: 1 });
      expect(result.bodyParams).toEqual({
        to: 'test@example.com',
        from: 'sender@example.com'
      });
    });

    test('moves all params to query for GET requests', () => {
      const params = {
        limit: 10,
        page: 1,
        to: 'test@example.com',
        from: 'sender@example.com'
      };
      const operation = {
        parameters: [
          { name: 'limit', in: 'query' },
          { name: 'page', in: 'query' }
        ]
      };

      const result = serverModule.separateParameters(params, operation, 'GET');

      expect(result.queryParams).toEqual({
        limit: 10,
        page: 1,
        to: 'test@example.com',
        from: 'sender@example.com'
      });
      expect(result.bodyParams).toEqual({});
    });

    test('handles operation with no parameters defined', () => {
      const params = { to: 'test@example.com' };
      const operation = {};

      const result = serverModule.separateParameters(params, operation, 'POST');

      expect(result.queryParams).toEqual({});
      expect(result.bodyParams).toEqual({ to: 'test@example.com' });
    });
  });

  describe('appendQueryString()', () => {
    test('appends query parameters to path', () => {
      const result = serverModule.appendQueryString('/v3/domains', { limit: 10, skip: 0 });
      expect(result).toBe('/v3/domains?limit=10&skip=0');
    });

    test('returns original path if no query parameters', () => {
      const result = serverModule.appendQueryString('/v3/domains', {});
      expect(result).toBe('/v3/domains');
    });

    test('skips null and undefined values', () => {
      const result = serverModule.appendQueryString('/v3/domains', {
        limit: 10,
        skip: null,
        page: undefined
      });
      expect(result).toBe('/v3/domains?limit=10');
    });
  });

  describe('sanitizeToolId()', () => {
    test('lowercases and replaces non-word characters', () => {
      expect(serverModule.sanitizeToolId('GET-/v3/domains')).toBe('get--v3-domains');
    });

    test('preserves hyphens and underscores', () => {
      expect(serverModule.sanitizeToolId('get-v3-domain_name')).toBe('get-v3-domain_name');
    });
  });

  describe('getRequestContentType()', () => {
    test('returns form-urlencoded when no requestBody', () => {
      const result = serverModule.getRequestContentType({});
      expect(result).toBe('application/x-www-form-urlencoded');
    });

    test('returns application/json when available', () => {
      const operation = {
        requestBody: {
          content: {
            'application/json': { schema: { type: 'object' } }
          }
        }
      };
      expect(serverModule.getRequestContentType(operation)).toBe('application/json');
    });

    test('prefers application/json over form-urlencoded', () => {
      const operation = {
        requestBody: {
          content: {
            'application/x-www-form-urlencoded': { schema: { type: 'object' } },
            'application/json': { schema: { type: 'object' } }
          }
        }
      };
      expect(serverModule.getRequestContentType(operation)).toBe('application/json');
    });

    test('returns form-urlencoded when only that is available', () => {
      const operation = {
        requestBody: {
          content: {
            'application/x-www-form-urlencoded': { schema: { type: 'object' } }
          }
        }
      };
      expect(serverModule.getRequestContentType(operation)).toBe('application/x-www-form-urlencoded');
    });

    test('returns form-urlencoded when only multipart/form-data is available', () => {
      const operation = {
        requestBody: {
          content: {
            'multipart/form-data': { schema: { type: 'object' } }
          }
        }
      };
      expect(serverModule.getRequestContentType(operation)).toBe('application/x-www-form-urlencoded');
    });

    test('falls back to form-urlencoded for unknown content types', () => {
      const operation = {
        requestBody: {
          content: {
            'text/plain': { schema: { type: 'string' } }
          }
        }
      };
      expect(serverModule.getRequestContentType(operation)).toBe('application/x-www-form-urlencoded');
    });
  });

  describe('processParameters()', () => {
    test('processes required parameters', () => {
      const params = [
        { name: 'domain', in: 'path', required: true, schema: { type: 'string' } }
      ];
      const schema = {};

      serverModule.processParameters(params, schema, {});

      expect(schema.domain).toBeDefined();
      expect(schema.domain.isOptional()).toBe(false);
    });

    test('processes optional parameters', () => {
      const params = [
        { name: 'limit', in: 'query', required: false, schema: { type: 'number' } }
      ];
      const schema = {};

      serverModule.processParameters(params, schema, {});

      expect(schema.limit).toBeDefined();
      expect(schema.limit.isOptional()).toBe(true);
    });

    test('processes multiple parameters', () => {
      const params = [
        { name: 'domain', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'number' } },
        { name: 'page', in: 'query', required: false, schema: { type: 'number' } }
      ];
      const schema = {};

      serverModule.processParameters(params, schema, {});

      expect(Object.keys(schema)).toEqual(['domain', 'limit', 'page']);
    });
  });

  describe('buildParamsSchema()', () => {
    test('builds schema from path and query params', () => {
      const operation = {
        parameters: [
          { name: 'domain_name', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'number' } }
        ]
      };

      const result = serverModule.buildParamsSchema(operation, {});

      expect(result.domain_name).toBeDefined();
      expect(result.domain_name.isOptional()).toBe(false);
      expect(result.limit).toBeDefined();
      expect(result.limit.isOptional()).toBe(true);
    });

    test('builds schema including request body properties', () => {
      const operation = {
        parameters: [
          { name: 'domain_name', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                properties: {
                  to: { type: 'string', description: 'Recipient' },
                  subject: { type: 'string', description: 'Subject line' }
                },
                required: ['to']
              }
            }
          }
        }
      };

      const result = serverModule.buildParamsSchema(operation, {});

      expect(result.domain_name).toBeDefined();
      expect(result.to).toBeDefined();
      expect(result.to.isOptional()).toBe(false);
      expect(result.subject).toBeDefined();
      expect(result.subject.isOptional()).toBe(true);
    });

    test('handles operation with no parameters', () => {
      const operation = {};

      const result = serverModule.buildParamsSchema(operation, {});

      expect(result).toEqual({});
    });
  });

  describe('processRequestBody()', () => {
    test('processes JSON request body', () => {
      const requestBody = {
        content: {
          'application/json': {
            schema: {
              properties: {
                name: { type: 'string' },
                count: { type: 'number' }
              },
              required: ['name']
            }
          }
        }
      };
      const schema = {};

      serverModule.processRequestBody(requestBody, schema, {});

      expect(schema.name).toBeDefined();
      expect(schema.name.isOptional()).toBe(false);
      expect(schema.count).toBeDefined();
      expect(schema.count.isOptional()).toBe(true);
    });

    test('processes form-urlencoded request body', () => {
      const requestBody = {
        content: {
          'application/x-www-form-urlencoded': {
            schema: {
              properties: {
                to: { type: 'string' },
                from: { type: 'string' }
              },
              required: ['to', 'from']
            }
          }
        }
      };
      const schema = {};

      serverModule.processRequestBody(requestBody, schema, {});

      expect(schema.to).toBeDefined();
      expect(schema.from).toBeDefined();
    });

    test('resolves $ref in body schema', () => {
      const spec = {
        components: {
          schemas: {
            MessageBody: {
              properties: {
                to: { type: 'string' },
              },
              required: ['to']
            }
          }
        }
      };
      const requestBody = {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/MessageBody' }
          }
        }
      };
      const schema = {};

      serverModule.processRequestBody(requestBody, schema, spec);

      expect(schema.to).toBeDefined();
      expect(schema.to.isOptional()).toBe(false);
    });

    test('resolves $ref in body properties', () => {
      const spec = {
        components: {
          schemas: {
            EmailType: { type: 'string', format: 'email' }
          }
        }
      };
      const requestBody = {
        content: {
          'application/json': {
            schema: {
              properties: {
                email: { $ref: '#/components/schemas/EmailType' }
              },
              required: ['email']
            }
          }
        }
      };
      const schema = {};

      serverModule.processRequestBody(requestBody, schema, spec);

      expect(schema.email).toBeDefined();
    });

    test('does nothing when content is missing', () => {
      const schema = {};
      serverModule.processRequestBody({}, schema, {});
      expect(schema).toEqual({});
    });
  });

  describe('loadOpenApiSpec()', () => {
    test('throws error for non-existent file', () => {
      expect(() => {
        serverModule.loadOpenApiSpec('/nonexistent/path/openapi.yaml');
      }).toThrow();
    });
  });

  describe('generateToolsFromOpenApi()', () => {
    test('warns for endpoints not found in spec', () => {
      console.warn.mockClear();

      // Provide an empty spec - none of the endpoints will match
      serverModule.generateToolsFromOpenApi({ paths: {} });

      expect(console.warn).toHaveBeenCalled();
    });

    test('registers tools for matching endpoints', () => {
      const spec = {
        paths: {
          '/v4/domains': {
            get: {
              summary: 'Get domains',
              parameters: []
            }
          }
        }
      };

      // Should not throw
      expect(() => serverModule.generateToolsFromOpenApi(spec)).not.toThrow();
    });
  });

  // Clean up after all tests
  afterAll(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    process.exit = originalProcessExit;
  });
});

describe('openapiToZod()', () => {
  test('returns z.any() for null/undefined schema', () => {
    const result = serverModule.openapiToZod(null, {});
    expect(result._def.typeName).toBe('ZodAny');
  });

  test('converts string schema', () => {
    const result = serverModule.openapiToZod({ type: 'string', description: 'A test string' }, {});
    expect(result._def.typeName).toBe('ZodString');
    expect(result._def.description).toBe('A test string');
  });

  test('converts string with email format', () => {
    const result = serverModule.openapiToZod({ type: 'string', format: 'email' }, {});
    expect(result._def.typeName).toBe('ZodString');
    expect(result._def.checks.some(c => c.kind === 'email')).toBe(true);
  });

  test('converts string with uri format', () => {
    const result = serverModule.openapiToZod({ type: 'string', format: 'uri', description: 'A link' }, {});
    // The final .describe() overwrites the URI prefix, so description is just the original
    expect(result._def.typeName).toBe('ZodString');
    expect(result._def.description).toBe('A link');
  });

  test('converts enum schema', () => {
    const result = serverModule.openapiToZod({ type: 'string', enum: ['yes', 'no', 'maybe'] }, {});
    expect(result._def.typeName).toBe('ZodEnum');
    expect(result._def.values).toEqual(['yes', 'no', 'maybe']);
  });

  test('converts number schema with constraints', () => {
    const result = serverModule.openapiToZod({
      type: 'number', minimum: 1, maximum: 100, description: 'A constrained number'
    }, {});
    expect(result._def.typeName).toBe('ZodNumber');
    expect(result._def.checks.some(c => c.kind === 'min' && c.value === 1)).toBe(true);
    expect(result._def.checks.some(c => c.kind === 'max' && c.value === 100)).toBe(true);
  });

  test('converts integer schema', () => {
    const result = serverModule.openapiToZod({ type: 'integer', description: 'An int' }, {});
    expect(result._def.typeName).toBe('ZodNumber');
  });

  test('converts boolean schema', () => {
    const result = serverModule.openapiToZod({ type: 'boolean', description: 'A flag' }, {});
    expect(result._def.typeName).toBe('ZodBoolean');
  });

  test('converts array schema', () => {
    const result = serverModule.openapiToZod({
      type: 'array', items: { type: 'string' }, description: 'A list'
    }, {});
    expect(result._def.typeName).toBe('ZodArray');
  });

  test('converts object schema with properties', () => {
    const result = serverModule.openapiToZod({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' }
      },
      required: ['name'],
      description: 'A person'
    }, {});
    expect(result._def.typeName).toBe('ZodObject');
  });

  test('converts object schema without properties to record', () => {
    const result = serverModule.openapiToZod({ type: 'object' }, {});
    expect(result._def.typeName).toBe('ZodRecord');
  });

  test('converts schema with properties but no type', () => {
    const result = serverModule.openapiToZod({
      properties: {
        name: { type: 'string' }
      },
      required: ['name']
    }, {});
    expect(result._def.typeName).toBe('ZodObject');
  });

  test('converts oneOf schema', () => {
    const result = serverModule.openapiToZod({
      oneOf: [
        { type: 'string' },
        { type: 'number' }
      ]
    }, {});
    expect(result._def.typeName).toBe('ZodUnion');
  });

  test('converts anyOf schema', () => {
    const result = serverModule.openapiToZod({
      anyOf: [
        { type: 'string' },
        { type: 'boolean' }
      ]
    }, {});
    expect(result._def.typeName).toBe('ZodUnion');
  });

  test('resolves $ref correctly', () => {
    const fullSpec = {
      components: {
        schemas: {
          TestType: { type: 'string', description: 'Referenced type' }
        }
      }
    };
    const result = serverModule.openapiToZod({ $ref: '#/components/schemas/TestType' }, fullSpec);
    expect(result._def.typeName).toBe('ZodString');
    expect(result._def.description).toBe('Referenced type');
  });

  test('handles unresolvable $ref with fallback', () => {
    const result = serverModule.openapiToZod({ $ref: '#/components/schemas/Missing' }, { components: { schemas: {} } });
    expect(result._def.typeName).toBe('ZodAny');
  });

  test('handles EventSeverityType $ref fallback', () => {
    const result = serverModule.openapiToZod({ $ref: '#/components/schemas/EventSeverityType' }, { components: { schemas: {} } });
    expect(result._def.typeName).toBe('ZodEnum');
    expect(result._def.values).toEqual(['temporary', 'permanent']);
  });

  test('handles unsupported $ref format', () => {
    const result = serverModule.openapiToZod({ $ref: 'external.yaml#/Type' }, {});
    expect(result._def.typeName).toBe('ZodAny');
  });

  test('returns z.any() for unknown type with no properties', () => {
    const result = serverModule.openapiToZod({ type: 'unknown_type' }, {});
    expect(result._def.typeName).toBe('ZodAny');
  });
});

describe('getOperationDetails()', () => {
  test('returns operation details for valid path and method', () => {
    const openApiSpec = {
      paths: {
        '/test/path': {
          get: { operationId: 'getTest', summary: 'Test operation' }
        }
      }
    };

    const result = serverModule.getOperationDetails(openApiSpec, 'get', '/test/path');

    expect(result).toEqual({
      operation: { operationId: 'getTest', summary: 'Test operation' },
      operationId: 'get--test-path'
    });
  });

  test('returns null for invalid path', () => {
    const openApiSpec = {
      paths: { '/test/path': { get: { summary: 'Test' } } }
    };
    expect(serverModule.getOperationDetails(openApiSpec, 'get', '/nonexistent')).toBeNull();
  });

  test('returns null for invalid method', () => {
    const openApiSpec = {
      paths: { '/test/path': { get: { summary: 'Test' } } }
    };
    expect(serverModule.getOperationDetails(openApiSpec, 'post', '/test/path')).toBeNull();
  });

  test('handles case-insensitive method', () => {
    const openApiSpec = {
      paths: { '/test': { post: { summary: 'Post test' } } }
    };
    const result = serverModule.getOperationDetails(openApiSpec, 'POST', '/test');
    expect(result.operation.summary).toBe('Post test');
  });
});

describe('endpoint validation against OpenAPI spec', () => {
  const openApiSpec = serverModule.loadOpenApiSpec(
    new URL('../src/openapi.yaml', import.meta.url).pathname
  );

  test('every endpoint matches a path and method in the OpenAPI spec', () => {
    const missing = [];
    for (const endpoint of serverModule.endpoints) {
      const [method, path] = endpoint.split(' ');
      const result = serverModule.getOperationDetails(openApiSpec, method, path);
      if (!result) missing.push(endpoint);
    }
    expect(missing).toEqual([]);
  });

  test('every endpoint produces a tool ID within the 64 character limit', () => {
    const tooLong = [];
    for (const endpoint of serverModule.endpoints) {
      const [method, path] = endpoint.split(' ');
      const operationId = `${method}-${path.replace(/[^\w-]/g, '-').replace(/-+/g, '-')}`;
      const toolId = serverModule.sanitizeToolId(operationId);
      if (toolId.length > 64) tooLong.push({ endpoint, toolId, length: toolId.length });
    }
    expect(tooLong).toEqual([]);
  });

  test('every endpoint produces a unique tool ID', () => {
    const toolIds = new Map();
    for (const endpoint of serverModule.endpoints) {
      const [method, path] = endpoint.split(' ');
      const operationId = `${method}-${path.replace(/[^\w-]/g, '-').replace(/-+/g, '-')}`;
      const toolId = serverModule.sanitizeToolId(operationId);
      if (toolIds.has(toolId)) {
        toolIds.get(toolId).push(endpoint);
      } else {
        toolIds.set(toolId, [endpoint]);
      }
    }
    const duplicates = [...toolIds.entries()].filter(([, eps]) => eps.length > 1);
    expect(duplicates).toEqual([]);
  });

  test('every endpoint resolves to a supported content type', () => {
    const unsupported = [];
    for (const endpoint of serverModule.endpoints) {
      const [method, path] = endpoint.split(' ');
      const result = serverModule.getOperationDetails(openApiSpec, method, path);
      if (!result) continue;
      const contentType = serverModule.getRequestContentType(result.operation);
      if (!['application/json', 'application/x-www-form-urlencoded'].includes(contentType)) {
        unsupported.push({ endpoint, contentType });
      }
    }
    expect(unsupported).toEqual([]);
  });
});

describe('resolveReference()', () => {
  test('resolves reference path correctly', () => {
    const spec = {
      components: { schemas: { TestSchema: { type: 'string' } } }
    };
    expect(serverModule.resolveReference('#/components/schemas/TestSchema', spec))
      .toEqual({ type: 'string' });
  });

  test('handles nested reference path', () => {
    const spec = {
      components: { schemas: { Parent: { NestedType: { type: 'number' } } } }
    };
    expect(serverModule.resolveReference('#/components/schemas/Parent/NestedType', spec))
      .toEqual({ type: 'number' });
  });
});
