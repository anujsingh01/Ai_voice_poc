output "load_balancer_dns" {
  description = "Point var.domain here (CNAME, or Route 53 alias)"
  value       = aws_lb.main.dns_name
}

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "audio_bucket" {
  value = aws_s3_bucket.audio.bucket
}

output "openai_secret_name" {
  description = "Put the OpenAI API key here once (console or aws secretsmanager put-secret-value)"
  value       = aws_secretsmanager_secret.openai.name
}

output "migrate_command" {
  description = "Run database migrations for a release"
  value       = "aws ecs run-task --cluster ${aws_ecs_cluster.main.name} --task-definition ${aws_ecs_task_definition.job["migrate"].family} --launch-type FARGATE --network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.private[*].id)}],securityGroups=[${aws_security_group.app.id}]}'"
}
