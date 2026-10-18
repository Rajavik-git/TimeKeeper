// Generated from openapi.yaml. Run npm run contract:gen.
export const requestContract = {
  "paths": {
    "/api/time-entries/{id}": {
      "patch": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/time_entries_id_patchRequest"
              }
            }
          }
        }
      }
    },
    "/api/day/approve": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/day_approve_postRequest"
              }
            }
          }
        }
      }
    },
    "/api/matters/{id}/approve": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostApiMattersIdApproveRequest"
              }
            }
          }
        }
      }
    },
    "/api/time-entries/{id}/discard": {
      "post": {
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostApiTimeEntriesIdDiscardRequest"
              }
            }
          }
        }
      }
    },
    "/api/blocks/{id}/recover": {
      "post": {
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostApiBlocksIdRecoverRequest"
              }
            }
          }
        }
      }
    },
    "/api/time-entries/manual": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/time_entries_manual_postRequest"
              }
            }
          }
        }
      }
    },
    "/api/matters": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/matters_postRequest"
              }
            }
          }
        }
      }
    },
    "/api/markers": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/markers_postRequest"
              }
            }
          }
        }
      }
    },
    "/api/expenses": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/expenses_postRequest"
              }
            }
          }
        }
      }
    },
    "/api/invoices": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/InvoiceSnapshot"
              }
            }
          }
        }
      }
    },
    "/api/sources/{id}/export": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/sources_id_export_postRequest"
              }
            }
          }
        }
      }
    },
    "/api/pauses": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/pauses_postRequest"
              }
            }
          }
        }
      }
    },
    "/api/pauses/{id}": {
      "patch": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/pauses_id_patchRequest"
              }
            }
          }
        }
      }
    },
    "/api/blocks/{id}/close": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/blocks_id_close_postRequest"
              }
            }
          }
        }
      }
    },
    "/api/firm/{id}": {
      "patch": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/firm_id_patchRequest"
              }
            }
          }
        }
      }
    },
    "/api/setting/{id}": {
      "patch": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/setting_id_patchRequest"
              }
            }
          }
        }
      }
    },
    "/api/client/{id}": {
      "patch": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/client_id_patchRequest"
              }
            }
          }
        }
      }
    },
    "/api/matter/{id}": {
      "patch": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/matter_id_patchRequest"
              }
            }
          }
        }
      }
    },
    "/api/task/{id}": {
      "patch": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/task_id_patchRequest"
              }
            }
          }
        }
      }
    },
    "/api/clients": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/clients_postRequest"
              }
            }
          }
        }
      }
    },
    "/api/tasks": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/tasks_postRequest"
              }
            }
          }
        }
      }
    },
    "/api/client-rules": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/client_rules_postRequest"
              }
            }
          }
        }
      }
    },
    "/api/work-periods": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/openPeriodRequest"
              }
            }
          }
        }
      }
    },
    "/api/questions": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/createQuestionRequest"
              }
            }
          }
        }
      }
    },
    "/api/commands/start": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostCommandsStartRequest"
              }
            }
          }
        }
      }
    },
    "/api/commands/end": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostCommandsEndRequest"
              }
            }
          }
        }
      }
    },
    "/api/work-periods/{id}/assignment": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostWorkPeriodsIdAssignmentRequest"
              }
            }
          }
        }
      }
    },
    "/api/work-periods/{id}/duration-override": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostWorkPeriodsIdDurationOverrideRequest"
              }
            }
          }
        }
      }
    },
    "/api/work-periods/{id}/detected-duration": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostWorkPeriodsIdDetectedDurationRequest"
              }
            }
          }
        }
      }
    },
    "/api/work-periods/{id}/validate-time": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostWorkPeriodsIdValidateTimeRequest"
              }
            }
          }
        }
      }
    },
    "/api/work-periods/{id}/billing-status": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostWorkPeriodsIdBillingStatusRequest"
              }
            }
          }
        }
      }
    },
    "/api/questions/answer": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostQuestionsAnswerRequest"
              }
            }
          }
        }
      }
    },
    "/api/sources/{instanceId}/{contentType}/{externalId}/validate": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostSourcesInstanceIdContentTypeExternalIdValidateRequest"
              }
            }
          }
        }
      }
    },
    "/api/work-periods/manual": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostWorkPeriodsManualRequest"
              }
            }
          }
        }
      }
    },
    "/api/work-periods/{id}/details": {
      "patch": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PatchWorkPeriodsIdDetailsRequest"
              }
            }
          }
        }
      }
    },
    "/api/sources/{instanceId}/{contentType}/{externalId}/availability": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostSourcesInstanceIdContentTypeExternalIdAvailabilityRequest"
              }
            }
          }
        }
      }
    },
    "/api/billing/expenses": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostBillingExpensesRequest"
              }
            }
          }
        }
      }
    },
    "/api/cases/{id}/source-pack": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PostCasesIdSourcePackRequest"
              }
            }
          }
        }
      }
    },
    "/api/sources/import": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/importSourceRequest"
              }
            }
          }
        }
      }
    },
    "/api/reconstruction/propose": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/proposeReconstructionRequest"
              }
            }
          }
        }
      }
    },
    "/api/settings/rate": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/setGlobalRateRequest"
              }
            }
          }
        }
      }
    },
    "/api/catalog/clients": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateCatalogClientRequest"
              }
            }
          }
        }
      }
    },
    "/api/catalog/cases": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateCatalogCaseRequest"
              }
            }
          }
        }
      }
    },
    "/api/catalog/clients/{id}": {
      "patch": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PatchCatalogClientRequest"
              }
            }
          }
        }
      }
    },
    "/api/catalog/cases/{id}": {
      "patch": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PatchCatalogCaseRequest"
              }
            }
          }
        }
      }
    },
    "/api/catalog/task-types": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateCatalogTaskTypeRequest"
              }
            }
          }
        }
      }
    },
    "/api/catalog/task-types/{id}": {
      "patch": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PatchCatalogTaskTypeRequest"
              }
            }
          }
        }
      }
    },
    "/api/catalog/settings": {
      "patch": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PatchCatalogSettingsRequest"
              }
            }
          }
        }
      }
    },
    "/api/catalog/markers": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateCatalogMarkerRequest"
              }
            }
          }
        }
      }
    },
    "/api/catalog/client-rules": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateCatalogClientRuleRequest"
              }
            }
          }
        }
      }
    },
    "/api/catalog/cases/{id}/source-pack": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CanonicalSourcePackRequest"
              }
            }
          }
        }
      }
    },
    "/api/recognize": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/RecognizeWindowRequest"
              }
            }
          }
        }
      }
    },
    "/api/periods/switch": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PeriodSwitchRequest"
              }
            }
          }
        }
      }
    },
    "/api/pill/decision": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PillDecisionRequest"
              }
            }
          }
        }
      }
    },
    "/api/pill/undo": {
      "post": {
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PillUndoRequest"
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "time_entries_id_patchRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "matter_id": {
            "description": "Requires expected_assignment_revision when assigning a case through the compatibility route.",
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "pattern": "\\S"
              },
              {
                "type": "null"
              }
            ]
          },
          "expected_assignment_revision": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "billable": {
            "type": "boolean"
          },
          "reason": {
            "anyOf": [
              {
                "$ref": "#/components/schemas/NonbillableReason"
              },
              {
                "type": "null"
              }
            ]
          },
          "label": {
            "type": "string"
          },
          "review_status": {
            "type": "string",
            "enum": [
              "approved"
            ]
          },
          "expected_effective_revision": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [],
        "allOf": [
          {
            "if": {
              "properties": {
                "review_status": {
                  "const": "approved"
                }
              },
              "required": [
                "review_status"
              ]
            },
            "then": {
              "required": [
                "expected_effective_revision"
              ]
            }
          }
        ]
      },
      "NonbillableReason": {
        "type": "string",
        "enum": [
          "offered",
          "internal",
          "admin"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "day_approve_postRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "date": {
            "type": "string",
            "format": "date"
          },
          "expected_effective_revisions": {
            "type": "object",
            "additionalProperties": {
              "type": "integer",
              "minimum": 0
            }
          }
        },
        "required": [
          "date",
          "expected_effective_revisions"
        ]
      },
      "PostApiMattersIdApproveRequest": {
        "type": "object",
        "properties": {
          "expected_effective_revisions": {
            "type": "object",
            "additionalProperties": {
              "type": "integer",
              "minimum": 0
            }
          }
        },
        "required": [
          "expected_effective_revisions"
        ],
        "additionalProperties": false
      },
      "PostApiTimeEntriesIdDiscardRequest": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      },
      "PostApiBlocksIdRecoverRequest": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      },
      "time_entries_manual_postRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "matter_id": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "pattern": "\\S"
              }
            ]
          },
          "task_id": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "date": {
            "type": "string",
            "format": "date"
          },
          "tenths_of_hour": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "label": {
            "type": "string"
          }
        },
        "required": [
          "matter_id",
          "task_id",
          "date",
          "tenths_of_hour",
          "label"
        ]
      },
      "matters_postRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "client_id": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "pattern": "\\S"
              }
            ]
          },
          "title": {
            "type": "string"
          },
          "opposing_party": {
            "type": "string"
          }
        },
        "required": [
          "client_id",
          "title"
        ]
      },
      "markers_postRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "matter_id": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "pattern": "\\S"
              }
            ]
          },
          "type": {
            "enum": [
              "case_number",
              "opposing_party",
              "file",
              "email",
              "domain",
              "keyword"
            ]
          },
          "value": {
            "type": "string"
          }
        },
        "required": [
          "matter_id",
          "type",
          "value"
        ]
      },
      "expenses_postRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "matter_id": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "pattern": "\\S"
              }
            ]
          },
          "date": {
            "type": "string",
            "format": "date"
          },
          "label": {
            "type": "string"
          },
          "type": {
            "$ref": "#/components/schemas/ExpenseType"
          },
          "amount_cents": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          }
        },
        "required": [
          "matter_id",
          "date",
          "label",
          "type",
          "amount_cents"
        ]
      },
      "ExpenseType": {
        "type": "string",
        "enum": [
          "expense",
          "disbursement"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "InvoiceSnapshot": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "caseId",
          "type",
          "periodIds",
          "revisions",
          "billedMinutes",
          "rateCents",
          "rateOrigin",
          "feesCents",
          "subtotalCents",
          "expensesCents",
          "disbursementsCents",
          "vatCents",
          "totalCents",
          "lines"
        ],
        "properties": {
          "caseId": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "pattern": "\\S"
              }
            ]
          },
          "type": {
            "$ref": "#/components/schemas/InvoiceType"
          },
          "periodIds": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "revisions": {
            "type": "object",
            "additionalProperties": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            }
          },
          "billedMinutes": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "rateCents": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "rateOrigin": {
            "$ref": "#/components/schemas/RateOrigin"
          },
          "feesCents": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "subtotalCents": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "expensesCents": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "disbursementsCents": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "vatCents": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "totalCents": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "lines": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "origin",
                "originId",
                "label",
                "billedMinutes",
                "rateCents",
                "amountCents",
                "vat"
              ],
              "properties": {
                "origin": {
                  "$ref": "#/components/schemas/InvoiceLineOrigin"
                },
                "originId": {
                  "type": "string",
                  "minLength": 1
                },
                "label": {
                  "type": "string"
                },
                "billedMinutes": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                },
                "rateCents": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                },
                "amountCents": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                },
                "vat": {
                  "type": "boolean"
                }
              }
            }
          },
          "timeZone": {
            "type": "string",
            "description": "IANA timezone for calendar dates. Stored with the new snapshot or export."
          }
        }
      },
      "InvoiceType": {
        "type": "string",
        "enum": [
          "deposit",
          "final"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "RateOrigin": {
        "type": "string",
        "enum": [
          "base",
          "client",
          "matter",
          "flat_fee"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "InvoiceLineOrigin": {
        "type": "string",
        "enum": [
          "work_period",
          "flat_fee",
          "expense"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "sources_id_export_postRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "options": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "options"
        ]
      },
      "pauses_postRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "date": {
            "type": "string",
            "format": "date"
          },
          "start_time": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          }
        },
        "required": [
          "date",
          "start_time"
        ]
      },
      "pauses_id_patchRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "end_time": {
            "type": "string"
          }
        },
        "required": [
          "end_time"
        ]
      },
      "blocks_id_close_postRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "minutes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          }
        },
        "required": [
          "minutes"
        ]
      },
      "firm_id_patchRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "lawyer_name": {
            "type": "string"
          },
          "address": {
            "type": "string"
          },
          "vat_number": {
            "type": "string"
          },
          "base_rate_cents": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "base_unit": {
            "$ref": "#/components/schemas/BaseUnit"
          },
          "vat_rate": {
            "type": "number"
          }
        },
        "required": []
      },
      "BaseUnit": {
        "type": "string",
        "enum": [
          "hour",
          "intervention"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "setting_id_patchRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "confidence_threshold": {
            "type": "number"
          },
          "excluded_apps": {
            "type": "string"
          },
          "capture_retention": {
            "type": "string"
          },
          "notifications": {
            "type": "boolean"
          },
          "pill_position": {
            "type": "string"
          },
          "invoice_prefix": {
            "type": "string"
          },
          "next_number": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "pill_always_on_top": {
            "type": "boolean"
          },
          "pill_display": {
            "$ref": "#/components/schemas/PillDisplay"
          },
          "pill_withhold_calls": {
            "type": "boolean"
          }
        },
        "required": []
      },
      "PillDisplay": {
        "type": "string",
        "enum": [
          "fees",
          "time",
          "case"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "client_id_patchRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "name": {
            "type": "string"
          },
          "type": {
            "$ref": "#/components/schemas/ClientType"
          },
          "mode": {
            "$ref": "#/components/schemas/ClientBillingMode"
          },
          "rate_cents": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "vat_applicable": {
            "type": "boolean"
          },
          "billing_address": {
            "type": "string"
          }
        },
        "required": []
      },
      "ClientType": {
        "type": "string",
        "enum": [
          "individual",
          "company"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "ClientBillingMode": {
        "type": "string",
        "enum": [
          "hourly",
          "subscription"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "matter_id_patchRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "client_id": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "pattern": "\\S"
              }
            ]
          },
          "title": {
            "type": "string"
          },
          "category": {
            "type": "string"
          },
          "case_number": {
            "type": "string"
          },
          "opposing_party": {
            "type": "string"
          },
          "mode": {
            "$ref": "#/components/schemas/CaseBillingMode"
          },
          "own_rate_cents": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "flat_fee_cents": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "hour_cap": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          },
          "success_fee_percent": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          },
          "budget_cents": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "status": {
            "type": "string",
            "enum": [
              "open",
              "closed"
            ]
          },
          "opened_on": {
            "type": "string",
            "format": "date"
          }
        },
        "required": []
      },
      "CaseBillingMode": {
        "type": "string",
        "enum": [
          "hourly",
          "flat_fee"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "task_id_patchRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "code": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "billable_by_default": {
            "type": "boolean"
          },
          "off_screen": {
            "type": "boolean"
          },
          "sort_order": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        },
        "required": []
      },
      "clients_postRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "name": {
            "type": "string"
          },
          "rate_cents": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "code": {
            "type": "string",
            "pattern": "^[A-Z][A-Z0-9]*$"
          }
        },
        "required": [
          "name",
          "rate_cents",
          "code"
        ]
      },
      "tasks_postRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "code": {
            "type": "string"
          },
          "label": {
            "type": "string"
          }
        },
        "required": [
          "code",
          "label"
        ]
      },
      "client_rules_postRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "client_id": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              },
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "pattern": "\\S"
              }
            ]
          },
          "type": {
            "$ref": "#/components/schemas/ClientRuleType"
          }
        },
        "required": [
          "client_id",
          "type"
        ]
      },
      "ClientRuleType": {
        "type": "string",
        "enum": [
          "daily_research_cap",
          "nonbillable_travel"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "openPeriodRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "sessionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "caseId": {
            "type": [
              "string",
              "null"
            ],
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$"
          },
          "origin": {
            "$ref": "#/components/schemas/AssignmentOrigin"
          },
          "mode": {
            "$ref": "#/components/schemas/PeriodOpenMode"
          }
        },
        "required": [
          "id",
          "sessionId",
          "caseId",
          "startedAt",
          "origin",
          "mode"
        ]
      },
      "AssignmentOrigin": {
        "type": "string",
        "enum": [
          "unresolved",
          "automatic",
          "lawyer"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "PeriodOpenMode": {
        "type": "string",
        "enum": [
          "current",
          "recovery"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "createQuestionRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "questionId",
          "sessionId",
          "periodId",
          "expectedAssignmentRevision"
        ],
        "properties": {
          "questionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "sessionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "periodId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "expectedAssignmentRevision": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        }
      },
      "PostCommandsStartRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "producerId",
          "commandId",
          "sessionId",
          "occurredAt"
        ],
        "properties": {
          "producerId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "commandId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "sessionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "occurredAt": {
            "type": "string",
            "format": "date-time",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$"
          },
          "prerequisiteCommandId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          }
        }
      },
      "PostCommandsEndRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "producerId",
          "commandId",
          "sessionId",
          "occurredAt"
        ],
        "properties": {
          "producerId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "commandId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "sessionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "occurredAt": {
            "type": "string",
            "format": "date-time",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$"
          },
          "prerequisiteCommandId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          }
        }
      },
      "PostWorkPeriodsIdAssignmentRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "caseId",
          "expectedAssignmentRevision",
          "origin"
        ],
        "properties": {
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "expectedAssignmentRevision": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "origin": {
            "type": "string",
            "enum": [
              "lawyer",
              "automatic"
            ]
          }
        }
      },
      "PostWorkPeriodsIdDurationOverrideRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "durationMs",
          "expectedRevision"
        ],
        "properties": {
          "durationMs": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 0
          }
        }
      },
      "PostWorkPeriodsIdDetectedDurationRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "durationMs"
        ],
        "properties": {
          "durationMs": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0,
            "maximum": 9007199254740991
          }
        }
      },
      "PostWorkPeriodsIdValidateTimeRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "expectedEffectiveRevision"
        ],
        "properties": {
          "expectedEffectiveRevision": {
            "type": "integer",
            "minimum": 0
          }
        }
      },
      "PostWorkPeriodsIdBillingStatusRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "status",
          "expectedRevision"
        ],
        "properties": {
          "status": {
            "$ref": "#/components/schemas/BillingStatus"
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 0
          }
        }
      },
      "BillingStatus": {
        "type": "string",
        "enum": [
          "unbilled",
          "billed"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "PostQuestionsAnswerRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "questionId",
          "sessionId",
          "periodId",
          "expectedAssignmentRevision",
          "caseId",
          "responseCommandId"
        ],
        "properties": {
          "questionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "sessionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "periodId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "expectedAssignmentRevision": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "responseCommandId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          }
        }
      },
      "PostSourcesInstanceIdContentTypeExternalIdValidateRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "PostWorkPeriodsManualRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "sessionId",
          "caseId",
          "startedAt",
          "durationMs",
          "taskTypeId",
          "label"
        ],
        "properties": {
          "sessionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "startedAt": {
            "type": "string",
            "format": "date-time",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$"
          },
          "durationMs": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "taskTypeId": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "label": {
            "type": "string"
          }
        }
      },
      "PatchWorkPeriodsIdDetailsRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "expectedRevision"
        ],
        "properties": {
          "label": {
            "type": "string"
          },
          "billable": {
            "type": "boolean"
          },
          "nonbillableReason": {
            "anyOf": [
              {
                "$ref": "#/components/schemas/NonbillableReason"
              },
              {
                "type": "null"
              }
            ]
          },
          "excluded": {
            "type": "boolean"
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 0
          }
        }
      },
      "PostSourcesInstanceIdContentTypeExternalIdAvailabilityRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "availability"
        ],
        "properties": {
          "availability": {
            "type": "string",
            "enum": [
              "available",
              "unavailable"
            ]
          }
        }
      },
      "PostBillingExpensesRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "caseId",
          "date",
          "label",
          "type",
          "amountCents"
        ],
        "properties": {
          "caseId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "date": {
            "type": "string",
            "format": "date"
          },
          "label": {
            "type": "string"
          },
          "type": {
            "$ref": "#/components/schemas/ExpenseType"
          },
          "amountCents": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        }
      },
      "PostCasesIdSourcePackRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "scope",
          "options"
        ],
        "properties": {
          "scope": {
            "type": "string",
            "enum": [
              "invoice",
              "case",
              "period",
              "chosen"
            ]
          },
          "invoiceId": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "from": {
            "type": "string",
            "format": "date"
          },
          "to": {
            "type": "string",
            "format": "date"
          },
          "periodIds": {
            "type": "array",
            "items": {
              "anyOf": [
                {
                  "type": "string",
                  "minLength": 1
                },
                {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 9007199254740991
                }
              ]
            }
          },
          "options": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "timeZone": {
            "type": "string",
            "description": "IANA timezone for calendar dates. Stored with the new snapshot or export."
          }
        }
      },
      "importSourceRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "periodId": {
            "type": [
              "string",
              "null"
            ],
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "instanceId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "contentType": {
            "type": "string",
            "minLength": 1
          },
          "externalId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "recordedAt": {
            "type": "string",
            "format": "date-time",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$"
          }
        },
        "required": [
          "id",
          "periodId",
          "instanceId",
          "contentType",
          "externalId",
          "recordedAt"
        ]
      },
      "proposeReconstructionRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "periodId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "startedAt": {
            "type": "string",
            "format": "date-time",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$"
          },
          "endedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$"
          },
          "sourceReferences": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "id",
          "periodId",
          "expectedRevision",
          "startedAt",
          "endedAt",
          "sourceReferences"
        ]
      },
      "setGlobalRateRequest": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "globalHourlyRateCents": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "currency": {
            "type": "string",
            "pattern": "^[A-Z]{3}$"
          },
          "workspaceId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          }
        },
        "required": [
          "globalHourlyRateCents",
          "currency",
          "workspaceId"
        ]
      },
      "CreateCatalogClientRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "name"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "type": {
            "$ref": "#/components/schemas/ClientType"
          },
          "mode": {
            "$ref": "#/components/schemas/ClientBillingMode"
          },
          "hourlyRateCents": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "vatApplicable": {
            "type": "boolean"
          },
          "billingAddress": {
            "type": "string"
          },
          "code": {
            "type": [
              "string",
              "null"
            ]
          },
          "active": {
            "type": "boolean"
          }
        }
      },
      "CreateCatalogCaseRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "clientId",
          "title"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "clientId": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "category": {
            "type": "string"
          },
          "caseNumber": {
            "type": "string"
          },
          "opposingParty": {
            "type": "string"
          },
          "mode": {
            "$ref": "#/components/schemas/CaseBillingMode"
          },
          "hourlyRateCents": {
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          },
          "flatFeeCents": {
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          },
          "hourCap": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          },
          "successFeePercent": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          },
          "budgetCents": {
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          },
          "status": {
            "$ref": "#/components/schemas/CaseStatus"
          },
          "openedOn": {
            "type": [
              "string",
              "null"
            ]
          },
          "reference": {
            "type": "string"
          }
        }
      },
      "CaseStatus": {
        "type": "string",
        "enum": [
          "active",
          "archived"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "PatchCatalogClientRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "name": {
            "type": "string"
          },
          "type": {
            "$ref": "#/components/schemas/ClientType"
          },
          "mode": {
            "$ref": "#/components/schemas/ClientBillingMode"
          },
          "hourlyRateCents": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "vatApplicable": {
            "type": "boolean"
          },
          "billingAddress": {
            "type": "string"
          },
          "code": {
            "type": [
              "string",
              "null"
            ]
          },
          "active": {
            "type": "boolean"
          }
        },
        "minProperties": 1
      },
      "PatchCatalogCaseRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "title": {
            "type": "string"
          },
          "category": {
            "type": "string"
          },
          "caseNumber": {
            "type": "string"
          },
          "opposingParty": {
            "type": "string"
          },
          "mode": {
            "$ref": "#/components/schemas/CaseBillingMode"
          },
          "hourlyRateCents": {
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          },
          "flatFeeCents": {
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          },
          "hourCap": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          },
          "successFeePercent": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          },
          "budgetCents": {
            "anyOf": [
              {
                "type": "integer"
              },
              {
                "type": "null"
              }
            ]
          },
          "status": {
            "$ref": "#/components/schemas/CaseStatus"
          }
        },
        "minProperties": 1
      },
      "CreateCatalogTaskTypeRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "code",
          "label"
        ],
        "properties": {
          "code": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "billableByDefault": {
            "type": "boolean"
          },
          "offScreen": {
            "type": "boolean"
          },
          "sortOrder": {
            "type": "integer"
          }
        }
      },
      "PatchCatalogTaskTypeRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "code": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "billableByDefault": {
            "type": "boolean"
          },
          "offScreen": {
            "type": "boolean"
          },
          "sortOrder": {
            "type": "integer"
          }
        },
        "minProperties": 1
      },
      "PatchCatalogSettingsRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "lawyerName": {
            "type": "string"
          },
          "address": {
            "type": "string"
          },
          "vatNumber": {
            "type": "string"
          },
          "globalHourlyRateCents": {
            "type": "integer"
          },
          "baseUnit": {
            "$ref": "#/components/schemas/BaseUnit"
          },
          "vatRate": {
            "type": "number"
          },
          "currency": {
            "type": "string",
            "pattern": "^[A-Z]{3}$"
          },
          "confidenceThreshold": {
            "type": "number"
          },
          "excludedApps": {
            "type": "string"
          },
          "captureRetention": {
            "type": "string"
          },
          "notifications": {
            "type": "boolean"
          },
          "pillPosition": {
            "type": "string"
          },
          "invoicePrefix": {
            "type": "string"
          },
          "nextNumber": {
            "type": "integer"
          },
          "pillAlwaysOnTop": {
            "type": "boolean"
          },
          "pillDisplay": {
            "$ref": "#/components/schemas/PillDisplay"
          },
          "pillWithholdCalls": {
            "type": "boolean"
          }
        },
        "minProperties": 1
      },
      "CreateCatalogMarkerRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "caseId",
          "type",
          "value"
        ],
        "properties": {
          "caseId": {
            "type": "string"
          },
          "type": {
            "$ref": "#/components/schemas/MarkerType"
          },
          "value": {
            "type": "string"
          },
          "weight": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          }
        }
      },
      "MarkerType": {
        "type": "string",
        "enum": [
          "reference",
          "case_number",
          "opposing_party",
          "client_name",
          "file",
          "email",
          "domain",
          "keyword"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "CreateCatalogClientRuleRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "clientId",
          "type"
        ],
        "properties": {
          "clientId": {
            "type": "string"
          },
          "type": {
            "$ref": "#/components/schemas/ClientRuleType"
          },
          "value": {
            "type": "integer"
          }
        }
      },
      "CanonicalSourcePackRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "scope",
          "options"
        ],
        "properties": {
          "scope": {
            "$ref": "#/components/schemas/SourcePackScope"
          },
          "options": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/SourcePackOption"
            },
            "uniqueItems": true
          },
          "invoiceId": {
            "type": "integer",
            "minimum": 1
          },
          "from": {
            "type": "string",
            "format": "date"
          },
          "to": {
            "type": "string",
            "format": "date"
          },
          "periodIds": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            },
            "uniqueItems": true
          },
          "timeZone": {
            "type": "string"
          }
        }
      },
      "SourcePackScope": {
        "type": "string",
        "enum": [
          "invoice",
          "case",
          "dateRange",
          "selectedPeriods"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "SourcePackOption": {
        "type": "string",
        "enum": [
          "blur",
          "personal",
          "audio",
          "audit"
        ],
        "description": "Generated from backend/domain/states.ts. Run npm run contract:gen."
      },
      "RecognizeWindowRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "windowTitle",
          "appName"
        ],
        "properties": {
          "windowTitle": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000,
            "pattern": "\\S"
          },
          "appName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000,
            "pattern": "\\S"
          }
        }
      },
      "PeriodSwitchRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "caseId",
          "windowTitle",
          "appName",
          "at"
        ],
        "properties": {
          "caseId": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "pattern": "\\S"
              },
              {
                "type": "null"
              }
            ]
          },
          "windowTitle": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000,
            "pattern": "\\S"
          },
          "appName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000,
            "pattern": "\\S"
          },
          "at": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$",
            "description": "UTC instant of the observed switch, taken from the PC clock."
          },
          "notClientWork": {
            "type": "boolean"
          }
        }
      },
      "PillDecisionRequest": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "caseId",
              "windowTitle",
              "appName",
              "at"
            ],
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "switch"
                ]
              },
              "caseId": {
                "anyOf": [
                  {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200,
                    "pattern": "\\S"
                  },
                  {
                    "type": "null"
                  }
                ],
                "description": "Null records non-client work."
              },
              "windowTitle": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000,
                "pattern": "\\S"
              },
              "appName": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000,
                "pattern": "\\S"
              },
              "at": {
                "type": "string",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$",
                "description": "UTC instant of the observed switch, taken from the PC clock."
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "periodId",
              "caseId",
              "expectedAssignmentRevision"
            ],
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "assign"
                ]
              },
              "periodId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "pattern": "\\S"
              },
              "caseId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "pattern": "\\S"
              },
              "expectedAssignmentRevision": {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "periodId",
              "expectedAssignmentRevision",
              "expectedEffectiveRevision"
            ],
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "exclude"
                ]
              },
              "periodId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200,
                "pattern": "\\S"
              },
              "expectedAssignmentRevision": {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              "expectedEffectiveRevision": {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "periodIds",
              "expectedEffectiveRevisions"
            ],
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "validate"
                ]
              },
              "periodIds": {
                "type": "array",
                "minItems": 1,
                "maxItems": 500,
                "uniqueItems": true,
                "items": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200,
                  "pattern": "\\S"
                }
              },
              "expectedEffectiveRevisions": {
                "type": "object",
                "additionalProperties": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                }
              }
            }
          }
        ]
      },
      "PillUndoRequest": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "undoToken"
        ],
        "properties": {
          "undoToken": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "\\S"
          }
        }
      }
    }
  }
} as const;
