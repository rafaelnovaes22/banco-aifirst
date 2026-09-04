# PORQUÊ: serve o index.html único via nginx. Sem build, sem runtime.
# Porta 8080 fixa, igual à variável PORT do serviço e ao target do domínio.
FROM nginx:1.27-alpine
COPY index.html /usr/share/nginx/html/index.html
COPY app.html /usr/share/nginx/html/app.html
COPY guardrails.js /usr/share/nginx/html/guardrails.js
COPY assets/ /usr/share/nginx/html/assets/
COPY styles/ /usr/share/nginx/html/styles/
COPY scripts/ /usr/share/nginx/html/scripts/
COPY governance/ /usr/share/nginx/html/governance/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
