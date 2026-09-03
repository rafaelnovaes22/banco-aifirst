# PORQUÊ: serve o index.html único via nginx. Sem build, sem runtime.
# Porta 8080 fixa, igual à variável PORT do serviço e ao target do domínio.
FROM nginx:1.27-alpine
COPY index.html /usr/share/nginx/html/index.html
COPY assets/ /usr/share/nginx/html/assets/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
