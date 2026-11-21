# Public entry point: HTTPS load balancer (HTTP redirects to HTTPS) protected by AWS WAF.

resource "aws_lb" "main" {
  # checkov:skip=CKV_AWS_91: access logs would store candidate link tokens (they are in the URL path); WAF logs below redact paths
  # checkov:skip=CKV_AWS_150: deletion protection is on in production; staging is disposable
  name                       = local.name
  load_balancer_type         = "application"
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = local.production
  idle_timeout               = 120 # slow mobile uploads
}

resource "aws_lb_target_group" "web" {
  name        = "${local.name}-web"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  deregistration_delay = 30
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# ---------- WAF ----------

resource "aws_wafv2_ip_set" "offices" {
  name               = "${local.name}-offices"
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = var.office_ip_cidrs
}

resource "aws_wafv2_web_acl" "main" {
  name  = local.name
  scope = "REGIONAL"
  default_action {
    allow {}
  }

  # 1. The transcription worker API answers only to the offices' IPs (it also needs a worker token).
  rule {
    name     = "worker-api-offices-only"
    priority = 1
    action {
      block {}
    }
    statement {
      and_statement {
        statement {
          byte_match_statement {
            search_string         = "/api/worker/"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
        statement {
          not_statement {
            statement {
              ip_set_reference_statement { arn = aws_wafv2_ip_set.offices.arn }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "worker-api-offices-only"
      sampled_requests_enabled   = true
    }
  }

  # 2. Per-IP flood limit (the app has its own per-account and per-link limits on top).
  rule {
    name     = "rate-limit-per-ip"
    priority = 2
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 1500 # requests per 5 minutes per IP
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-per-ip"
      sampled_requests_enabled   = true
    }
  }

  # 3. AWS managed protections. The body-size rule is switched to count-only: it blocks any request
  #    body over 8 KB, which would block every audio upload (the app enforces its own 15 MB cap).
  #    Candidate audio uploads skip the body-pattern rules too: random audio bytes can look like an
  #    attack signature. Those requests are still token-checked, type-sniffed and size-capped by the app.
  rule {
    name     = "aws-common"
    priority = 3
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
        scope_down_statement {
          not_statement {
            statement {
              regex_match_statement {
                regex_string = "^/api/i/[^/]+/answer/[0-9]+$"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 4
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-sqli"
    priority = 5
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesSQLiRuleSet"
        scope_down_statement {
          not_statement {
            statement {
              regex_match_statement {
                regex_string = "^/api/i/[^/]+/answer/[0-9]+$"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-sqli"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = local.name
    sampled_requests_enabled   = true
  }
}

# WAF decisions with the URL path and query redacted (candidate tokens live there).
resource "aws_cloudwatch_log_group" "waf" {
  # checkov:skip=CKV_AWS_338: 90 days on purpose (data minimisation)
  name              = "aws-waf-logs-${local.name}"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.data.arn
}

resource "aws_wafv2_web_acl_logging_configuration" "main" {
  resource_arn            = aws_wafv2_web_acl.main.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  redacted_fields {
    uri_path {}
  }
  redacted_fields {
    query_string {}
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}
